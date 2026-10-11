import { performance } from 'node:perf_hooks';

export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';

function cleanBaseUrl(value) {
  try {
    const url = new URL(value || DEFAULT_OLLAMA_URL);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    return url.toString().replace(/\/$/, '');
  } catch { throw new TypeError('OLLAMA_BASE_URL должен быть корректным HTTP URL.'); }
}

function normalizeName(value) { return typeof value === 'string' ? value.trim().toLowerCase().replace(/:latest$/, '') : ''; }
async function readJson(response) { try { return await response.json(); } catch { return {}; } }
function nsToMs(value) { return Number.isFinite(value) ? Math.round(value / 1e6) : null; }

export function createOllamaClient({ baseUrl = process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_URL, fetchImpl = globalThis.fetch } = {}) {
  const endpoint = cleanBaseUrl(baseUrl);

  async function call(path, options = {}) {
    const { timeoutMs = 180_000, ...requestOptions } = options;
    let response;
    try { response = await fetchImpl(`${endpoint}${path}`, { ...requestOptions, signal: AbortSignal.timeout(timeoutMs) }); }
    catch (cause) {
      const timedOut = cause?.name === 'TimeoutError';
      const error = new Error(timedOut ? 'Локальная модель не ответила вовремя.' : 'Ollama недоступен. Запустите `ollama serve`.');
      error.code = timedOut ? 'OLLAMA_TIMEOUT' : 'OLLAMA_UNAVAILABLE'; error.cause = cause; throw error;
    }
    const data = await readJson(response);
    if (!response.ok) { const error = new Error(data.error || `Ollama вернул HTTP ${response.status}.`); error.code = 'OLLAMA_ERROR'; throw error; }
    return data;
  }

  async function chat({ model, messages, options, keepAlive = '10m', timeoutMs = 180_000 }) {
    const started = performance.now();
    const data = await call('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages, stream: false, think: false, keep_alive: keepAlive, options }), timeoutMs });
    const wallMs = Math.round(performance.now() - started);
    const content = data.message?.content?.trim();
    if (!content) throw new Error('Ollama вернул пустой ответ.');
    const evalSeconds = data.eval_duration ? data.eval_duration / 1e9 : 0;
    return {
      content,
      metrics: {
        wallMs, totalMs: nsToMs(data.total_duration), loadMs: nsToMs(data.load_duration), promptMs: nsToMs(data.prompt_eval_duration), generationMs: nsToMs(data.eval_duration),
        promptTokens: data.prompt_eval_count ?? null, outputTokens: data.eval_count ?? null,
        tokensPerSecond: evalSeconds > 0 && Number.isFinite(data.eval_count) ? Math.round((data.eval_count / evalSeconds) * 10) / 10 : null,
      },
    };
  }

  return {
    baseUrl: endpoint,
    async status(models) {
      const [version, tags] = await Promise.all([call('/api/version'), call('/api/tags')]);
      const installed = tags.models || [];
      const details = Object.fromEntries(models.map(model => {
        const found = installed.find(item => normalizeName(item.name || item.model) === normalizeName(model));
        return [model, { installed: Boolean(found), sizeBytes: found?.size ?? null, quantization: found?.details?.quantization_level ?? null }];
      }));
      return { available: true, version: version.version || null, models: details };
    },
    generate: chat,
    async warmup(profile) { return chat({ model: profile.model, messages: [{ role: 'user', content: 'Ответь только: OK' }], options: { ...profile.options, num_predict: 2 }, keepAlive: '10m' }); },
    async running(model) {
      const data = await call('/api/ps');
      const found = (data.models || []).find(item => normalizeName(item.name || item.model) === normalizeName(model));
      return found ? { residentBytes: found.size ?? null, vramBytes: found.size_vram ?? null } : null;
    },
    async unload(model) { await call('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, stream: false, keep_alive: 0 }) }); },
  };
}
