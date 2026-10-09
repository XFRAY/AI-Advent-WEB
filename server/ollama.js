export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
export const DEFAULT_CHAT_MODEL = 'qwen3:1.7b';
export const DEFAULT_EMBEDDING_MODEL = 'embeddinggemma';

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

async function readJson(response) {
  try { return await response.json(); } catch { return {}; }
}

export function createOllamaClient({ baseUrl = process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_URL, fetchImpl = globalThis.fetch } = {}) {
  const endpoint = cleanBaseUrl(baseUrl);

  async function call(path, options = {}) {
    const { timeoutMs = 60_000, ...requestOptions } = options;
    let response;
    try {
      response = await fetchImpl(`${endpoint}${path}`, { ...requestOptions, signal: AbortSignal.timeout(timeoutMs) });
    } catch (cause) {
      const timedOut = cause?.name === 'TimeoutError';
      const error = new Error(timedOut ? 'Локальная модель не ответила за 60 секунд. Повторите запрос или перезапустите Ollama.' : 'Ollama недоступен. Запустите `ollama serve` и повторите попытку.');
      error.code = timedOut ? 'OLLAMA_TIMEOUT' : 'OLLAMA_UNAVAILABLE'; error.cause = cause; throw error;
    }
    const data = await readJson(response);
    if (!response.ok) {
      const error = new Error(data.error || `Ollama вернул HTTP ${response.status}.`);
      error.code = 'OLLAMA_ERROR'; throw error;
    }
    return data;
  }

  return {
    baseUrl: endpoint,
    async status(models) {
      const [version, tags] = await Promise.all([call('/api/version'), call('/api/tags')]);
      const installed = (tags.models || []).map(item => normalizeName(item.name || item.model));
      return { available: true, version: version.version || null, models: Object.fromEntries(models.map(model => [model, installed.includes(normalizeName(model))])) };
    },
    async embed(texts, model = DEFAULT_EMBEDDING_MODEL) {
      const data = await call('/api/embed', {
        timeoutMs: 120_000,
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, input: texts }),
      });
      if (!Array.isArray(data.embeddings) || data.embeddings.length !== texts.length) throw new Error('Ollama вернул некорректные embeddings.');
      return data.embeddings;
    },
    async generate({ model = DEFAULT_CHAT_MODEL, messages, format }) {
      const started = performance.now();
      const data = await call('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, format, stream: false, think: false, keep_alive: '5m', options: { temperature: 0.1, num_ctx: 4096, num_predict: 700 } }),
      });
      const content = data.message?.content?.trim();
      if (!content) throw new Error('Ollama вернул пустой ответ.');
      return { content, model: data.model || model, durationMs: Math.round(performance.now() - started), evalCount: data.eval_count || null };
    },
  };
}
