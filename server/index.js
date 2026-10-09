import 'dotenv/config';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import express from 'express';
import { createCloudGenerator, createLocalGenerator, publicSources, safeGenerate } from './RagCore.js';
import { createOllamaClient, DEFAULT_CHAT_MODEL, DEFAULT_EMBEDDING_MODEL } from './ollama.js';
import { createOllamaEmbedder, EmbeddingConfigurationError } from './indexing/embeddings.js';
import { buildIndex } from './indexing/pipeline.js';
import { searchIndex } from './indexing/search.js';
import { readIndexSummary } from './indexing/store.js';
import { loadCorpus } from './indexing/corpus.js';

export const MAX_QUESTION_LENGTH = 2_000;

export function createApp({ ollamaClient, embedder, localGenerator, cloudGenerator, indexesDir, manifestPath } = {}) {
  const app = express();
  const ollama = ollamaClient ?? createOllamaClient();
  const embeddingModel = embedder?.model || process.env.OLLAMA_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL;
  const chatModel = localGenerator?.model || process.env.OLLAMA_MODEL || DEFAULT_CHAT_MODEL;
  const localEmbedder = embedder ?? createOllamaEmbedder({ client: ollama, model: embeddingModel });
  const local = localGenerator ?? createLocalGenerator({ client: ollama, model: chatModel });
  const cloud = cloudGenerator ?? createCloudGenerator();
  let building = false;

  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Недопустимый источник запроса.' });
    if (req.method === 'POST' && !req.is('application/json')) return res.status(415).json({ error: 'Ожидается JSON.' });
    next();
  });
  app.use(express.json({ limit: '32kb' }));

  app.get('/api/rag/status', async (_req, res) => {
    const [index, corpus] = await Promise.all([readIndexSummary(indexesDir), loadCorpus({ manifestPath })]);
    const compatible = index.available && index.manifest.embedding.model === embeddingModel;
    let ollamaStatus;
    try { ollamaStatus = await ollama.status([chatModel, embeddingModel]); }
    catch (error) { ollamaStatus = { available: false, version: null, models: { [chatModel]: false, [embeddingModel]: false }, error: error.message }; }
    res.json({ ollama: ollamaStatus, local: { model: chatModel, ready: Boolean(ollamaStatus.models[chatModel]) }, embedding: { model: embeddingModel, ready: Boolean(ollamaStatus.models[embeddingModel]) }, cloud: { model: cloud.model, configured: cloud.configured }, index: { ...index, compatible, expectedModel: embeddingModel }, corpus: corpus.stats, building });
  });

  app.post('/api/rag/index', async (_req, res) => {
    if (building) return res.status(409).json({ error: 'Индексация уже выполняется.' });
    building = true;
    try { res.json(await buildIndex({ embedder: localEmbedder, indexesDir, manifestPath })); }
    catch (error) {
      const status = error instanceof EmbeddingConfigurationError || error.code === 'OLLAMA_UNAVAILABLE' ? 503 : 502;
      res.status(status).json({ error: `Не удалось построить локальный индекс: ${error.message}` });
    } finally { building = false; }
  });

  app.post('/api/rag/compare', async (req, res) => {
    const question = req.body?.question;
    if (typeof question !== 'string' || !question.trim() || question.length > MAX_QUESTION_LENGTH) return res.status(400).json({ error: `Введите вопрос от 1 до ${MAX_QUESTION_LENGTH} символов.` });
    const cleanQuestion = question.trim();
    const retrievalStarted = performance.now();
    try {
      const search = await searchIndex({ query: cleanQuestion, topK: 4, embedder: localEmbedder, indexesDir });
      const retrievalMs = Math.round(performance.now() - retrievalStarted);
      const sources = publicSources(search.results);
      const [localResult, cloudResult] = await Promise.all([safeGenerate(local, cleanQuestion, sources), safeGenerate(cloud, cleanQuestion, sources)]);
      res.json({ question: cleanQuestion, retrieval: { durationMs: retrievalMs, model: embeddingModel, sources: sources.map(({ text: _text, ...source }) => source) }, local: localResult, cloud: cloudResult });
    } catch (error) {
      const missing = error.code === 'ENOENT' || /отсутствует|несовместим|Перестройте индекс/.test(error.message);
      res.status(missing ? 409 : error.code === 'OLLAMA_UNAVAILABLE' ? 503 : 502).json({ error: missing ? `Локальный индекс не готов: ${error.message}` : error.message });
    }
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true, building }));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API-маршрут не найден.' }));
  app.use(express.static(fileURLToPath(new URL('../dist', import.meta.url))));
  app.use((error, _req, res, _next) => res.status(error.type === 'entity.too.large' ? 413 : 400).json({ error: 'Некорректный запрос.' }));
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 3001);
  createApp().listen(port, '127.0.0.1', () => console.log(`День 28 · локальный RAG: http://127.0.0.1:${port}`));
}
