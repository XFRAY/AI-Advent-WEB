import 'dotenv/config';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express from 'express';

export const DEFAULT_MODEL = 'qwen3:1.7b';
export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
export const MAX_MESSAGES = 40;
export const MAX_MESSAGE_LENGTH = 4_000;
export const MAX_CONTEXT_LENGTH = 32_000;

function cleanBaseUrl(value) {
  try {
    const url = new URL(value || DEFAULT_OLLAMA_URL);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    return url.toString().replace(/\/$/, '');
  } catch {
    throw new TypeError('OLLAMA_BASE_URL должен быть корректным HTTP URL.');
  }
}

function normalizeName(value) {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/:latest$/, '') : '';
}

function hasModel(models, requested) {
  const target = normalizeName(requested);
  return models.some(item => normalizeName(item.name || item.model) === target);
}

async function readJson(response) {
  try { return await response.json(); }
  catch { return {}; }
}

export function createOllamaClient({ baseUrl = process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_URL, model = process.env.OLLAMA_MODEL || DEFAULT_MODEL, fetchImpl = globalThis.fetch } = {}) {
  const endpoint = cleanBaseUrl(baseUrl);
  const selectedModel = model.trim() || DEFAULT_MODEL;

  async function call(path, options = {}) {
    let response;
    try {
      response = await fetchImpl(`${endpoint}${path}`, { ...options, signal: AbortSignal.timeout(120_000) });
    } catch (error) {
      const unavailable = new Error('Ollama недоступен. Запустите `ollama serve` и повторите попытку.');
      unavailable.code = 'OLLAMA_UNAVAILABLE';
      unavailable.cause = error;
      throw unavailable;
    }
    const data = await readJson(response);
    if (!response.ok) {
      const failure = new Error(data.error || `Ollama вернул HTTP ${response.status}.`);
      failure.code = 'OLLAMA_ERROR';
      throw failure;
    }
    return data;
  }

  return {
    model: selectedModel,
    baseUrl: endpoint,
    async status() {
      const [version, tags] = await Promise.all([call('/api/version'), call('/api/tags')]);
      const models = Array.isArray(tags.models) ? tags.models : [];
      return { available: true, version: version.version || null, model: selectedModel, modelReady: hasModel(models, selectedModel) };
    },
    async chat(messages) {
      const status = await this.status();
      if (!status.modelReady) {
        const missing = new Error(`Модель ${selectedModel} не установлена. Выполните \`ollama pull ${selectedModel}\`.`);
        missing.code = 'MODEL_MISSING';
        throw missing;
      }
      const data = await call('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: selectedModel, messages, stream: false, think: false }),
      });
      const content = data.message?.content?.trim();
      if (!content) {
        const invalid = new Error('Ollama вернул пустой ответ.');
        invalid.code = 'OLLAMA_ERROR';
        throw invalid;
      }
      return { content, model: data.model || selectedModel, totalDurationNs: data.total_duration || null, evalCount: data.eval_count || null };
    },
  };
}

export function createApp({ ollamaClient } = {}) {
  const app = express();
  const ollama = ollamaClient || createOllamaClient();

  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Недопустимый источник запроса.' });
    if (req.method === 'POST' && !req.is('application/json')) return res.status(415).json({ error: 'Ожидается JSON.' });
    next();
  });
  app.use(express.json({ limit: '128kb' }));

  app.get('/api/llm/status', async (_req, res) => {
    try { res.json(await ollama.status()); }
    catch (error) {
      const status = error.code === 'OLLAMA_UNAVAILABLE' ? 503 : 502;
      res.status(status).json({ available: false, model: ollama.model, modelReady: false, error: error.message });
    }
  });

  app.post('/api/llm/chat', async (req, res) => {
    const messages = req.body?.messages;
    if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
      return res.status(400).json({ error: `История должна содержать от 1 до ${MAX_MESSAGES} сообщений.` });
    }

    let contextLength = 0;
    const normalizedMessages = [];
    for (const message of messages) {
      if (!message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string') {
        return res.status(400).json({ error: 'Каждое сообщение должно содержать роль user или assistant и текст.' });
      }
      const content = message.content.trim();
      if (!content || content.length > MAX_MESSAGE_LENGTH) {
        return res.status(400).json({ error: `Длина каждого сообщения должна быть от 1 до ${MAX_MESSAGE_LENGTH} символов.` });
      }
      contextLength += content.length;
      normalizedMessages.push({ role: message.role, content });
    }
    if (contextLength > MAX_CONTEXT_LENGTH) {
      return res.status(400).json({ error: `Общий контекст не должен превышать ${MAX_CONTEXT_LENGTH} символов.` });
    }
    if (normalizedMessages.at(-1).role !== 'user') {
      return res.status(400).json({ error: 'Последнее сообщение в истории должно быть от пользователя.' });
    }

    const started = performance.now();
    try {
      const answer = await ollama.chat(normalizedMessages);
      res.json({ ...answer, durationMs: Math.round(performance.now() - started), local: true });
    } catch (error) {
      const status = error.code === 'OLLAMA_UNAVAILABLE' || error.code === 'MODEL_MISSING' ? 503 : 502;
      res.status(status).json({ error: error.message });
    }
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API-маршрут не найден.' }));
  app.use(express.static(fileURLToPath(new URL('../dist', import.meta.url))));
  app.use((error, _req, res, _next) => res.status(error.type === 'entity.too.large' ? 413 : 400).json({ error: 'Некорректный запрос.' }));
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 3001);
  createApp().listen(port, '127.0.0.1', () => console.log(`День 27 · локальный чат с памятью: http://127.0.0.1:${port}`));
}
