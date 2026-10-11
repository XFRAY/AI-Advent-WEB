import 'dotenv/config';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express from 'express';
import { createOllamaClient } from './ollama.js';
import { createRequestQueue, createRateLimiter } from './service-limits.js';

const numberFromEnv = (name, fallback, minimum = 1) => {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= minimum ? value : fallback;
};

export function readConfig(overrides = {}) {
  return {
    apiKey: process.env.API_KEY || 'change-me', model: process.env.OLLAMA_MODEL || 'qwen3:1.7b-q4_K_M',
    contextTokens: numberFromEnv('MAX_CONTEXT_TOKENS', 2048, 128), maxOutputTokens: numberFromEnv('MAX_OUTPUT_TOKENS', 512),
    rateLimit: numberFromEnv('RATE_LIMIT_REQUESTS', 10), rateWindowMs: numberFromEnv('RATE_LIMIT_WINDOW_MS', 60_000, 1000),
    concurrency: numberFromEnv('MAX_CONCURRENT_REQUESTS', 1), queueSize: numberFromEnv('MAX_QUEUE_SIZE', 4, 0),
    timeoutMs: numberFromEnv('GENERATION_TIMEOUT_MS', 180_000, 1000), ...overrides,
  };
}

function secureEqual(actual, expected) { const left = Buffer.from(actual || ''); const right = Buffer.from(expected || ''); return left.length === right.length && timingSafeEqual(left, right); }
export function estimateTokens(messages) { return messages.reduce((sum, message) => sum + 4 + Math.ceil(Buffer.byteLength(message.content, 'utf8') / 4), 2); }

function validateChat(body, config) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'Ожидается JSON-объект.';
  if (body.stream === true) return 'Потоковые ответы пока не поддерживаются: передайте stream: false.';
  if (body.model != null && body.model !== config.model) return `Доступна только модель ${config.model}.`;
  if (!Array.isArray(body.messages) || body.messages.length === 0) return 'messages должен быть непустым массивом.';
  const roles = new Set(['system', 'user', 'assistant']);
  if (body.messages.some(item => !item || !roles.has(item.role) || typeof item.content !== 'string' || !item.content.trim())) return 'Каждое сообщение должно содержать role и непустой строковый content.';
  if (body.temperature != null && (!Number.isFinite(body.temperature) || body.temperature < 0 || body.temperature > 2)) return 'temperature должен быть числом от 0 до 2.';
  if (body.max_tokens != null && (!Number.isInteger(body.max_tokens) || body.max_tokens < 1 || body.max_tokens > config.maxOutputTokens)) return `max_tokens должен быть целым числом от 1 до ${config.maxOutputTokens}.`;
  const maxTokens = body.max_tokens ?? config.maxOutputTokens; const inputTokens = estimateTokens(body.messages);
  if (inputTokens + maxTokens > config.contextTokens) return `Контекст слишком велик: примерно ${inputTokens} входных токенов + ${maxTokens} ответа, лимит ${config.contextTokens}.`;
  return null;
}

function authMiddleware(config) { return (req, res, next) => { const header = req.get('authorization') || ''; const token = header.startsWith('Bearer ') ? header.slice(7) : ''; if (!secureEqual(token, config.apiKey)) return res.status(401).set('WWW-Authenticate', 'Bearer').json({ error: { message: 'Неверный или отсутствующий API-ключ.', type: 'authentication_error' } }); req.rateKey = `${token}:${req.ip}`; next(); }; }
function errorPayload(message, type = 'server_error', code = null) { return { error: { message, type, code } }; }

export function createApp({ ollamaClient, config: configOverrides, now = Date.now } = {}) {
  const config = readConfig(configOverrides); const ollama = ollamaClient ?? createOllamaClient();
  const queue = createRequestQueue({ concurrency: config.concurrency, maxQueue: config.queueSize });
  const limiter = createRateLimiter({ limit: config.rateLimit, windowMs: config.rateWindowMs, now });
  const app = express(); app.set('trust proxy', Number(process.env.TRUST_PROXY || 0)); app.use(express.json({ limit: '128kb' }));
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use(['/api/status', '/v1'], authMiddleware(config));
  app.use(['/api/status', '/v1'], (req, res, next) => { const result = limiter.consume(req.rateKey); res.set('X-RateLimit-Limit', String(config.rateLimit)); res.set('X-RateLimit-Remaining', String(result.remaining)); res.set('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000))); if (!result.allowed) return res.status(429).set('Retry-After', String(result.retryAfter)).json(errorPayload('Превышен лимит запросов. Повторите позже.', 'rate_limit_error', 'rate_limit_exceeded')); next(); });

  app.get('/api/status', async (_req, res) => {
    let ollamaStatus; try { const result = await ollama.status([config.model]); ollamaStatus = { available: true, version: result.version, installed: result.models[config.model]?.installed ?? false }; } catch (error) { ollamaStatus = { available: false, error: error.message }; }
    res.json({ model: config.model, ollama: ollamaStatus, limits: { contextTokens: config.contextTokens, maxOutputTokens: config.maxOutputTokens, requestsPerWindow: config.rateLimit, windowMs: config.rateWindowMs, concurrency: config.concurrency, queueSize: config.queueSize }, runtime: queue.status() });
  });

  app.post('/v1/chat/completions', async (req, res) => {
    const validationError = validateChat(req.body, config); if (validationError) return res.status(400).json(errorPayload(validationError, 'invalid_request_error'));
    if (!queue.canAccept()) return res.status(429).set('Retry-After', '2').json(errorPayload('Очередь генерации заполнена. Повторите запрос позже.', 'rate_limit_error', 'queue_full'));
    const maxTokens = req.body.max_tokens ?? config.maxOutputTokens;
    try {
      const result = await queue.run(() => ollama.generate({ model: config.model, messages: req.body.messages.map(item => ({ role: item.role, content: item.content.trim() })), options: { num_ctx: config.contextTokens, num_predict: maxTokens, temperature: req.body.temperature ?? 0.3 }, keepAlive: '10m', timeoutMs: config.timeoutMs }));
      const promptTokens = result.metrics?.promptTokens ?? estimateTokens(req.body.messages); const completionTokens = result.metrics?.outputTokens ?? 0;
      res.json({ id: `chatcmpl-${randomUUID().replaceAll('-', '')}`, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: config.model, choices: [{ index: 0, message: { role: 'assistant', content: result.content }, finish_reason: 'stop' }], usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens } });
    } catch (error) { const unavailable = error.code === 'OLLAMA_UNAVAILABLE'; const timedOut = error.code === 'OLLAMA_TIMEOUT'; res.status(unavailable ? 503 : 502).json(errorPayload(error.message, timedOut ? 'timeout_error' : 'upstream_error', error.code || null)); }
  });

  app.use('/api', (_req, res) => res.status(404).json(errorPayload('API-маршрут не найден.', 'invalid_request_error'))); app.use('/v1', (_req, res) => res.status(404).json(errorPayload('API-маршрут не найден.', 'invalid_request_error')));
  app.use(express.static(fileURLToPath(new URL('../dist', import.meta.url))));
  app.use((error, _req, res, _next) => res.status(error.type === 'entity.too.large' ? 413 : 400).json(errorPayload('Некорректный JSON-запрос.', 'invalid_request_error')));
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) { const port = Number(process.env.PORT || 3001); const host = process.env.HOST || '0.0.0.0'; createApp().listen(port, host, () => console.log(`Day 30 private LLM: http://${host}:${port}`)); }
