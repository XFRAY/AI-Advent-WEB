import 'dotenv/config';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express from 'express';
import { loadCorpus } from './indexing/corpus.js';
import { createOpenAIEmbedder, EmbeddingConfigurationError } from './indexing/embeddings.js';
import { buildIndexes, STRATEGIES } from './indexing/pipeline.js';
import { searchIndexes } from './indexing/search.js';
import { deleteIndexes, readIndex, readIndexSummary } from './indexing/store.js';

function inputError(message) { const error = new TypeError(message); error.status = 400; return error; }

export function createApp({ embedder, indexesDir, manifestPath } = {}) {
  const app = express();
  let building = false;
  const getEmbedder = () => embedder ?? createOpenAIEmbedder();
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Недопустимый источник запроса.' });
    if (req.method === 'POST' && !req.is('application/json')) return res.status(415).json({ error: 'Ожидается JSON.' });
    next();
  });
  app.use(express.json({ limit: '16kb' }));
  app.get('/api/indexes', async (_req, res) => {
    try {
      const [corpus, ...indexes] = await Promise.all([loadCorpus({ manifestPath }), ...STRATEGIES.map(strategy => readIndexSummary(strategy, indexesDir))]);
      res.json({
        building,
        corpus: {
          ...corpus.stats,
          files: corpus.documents.map(document => ({ file: document.file, title: document.title, type: document.type, source: document.source, sections: document.sections.length })),
        },
        indexes,
      });
    } catch (error) { res.status(500).json({ error: `Не удалось прочитать корпус: ${error.message}` }); }
  });
  app.get('/api/documents/file', async (req, res) => {
    try {
      const corpus = await loadCorpus({ manifestPath });
      const document = corpus.documents.find(item => item.file === req.query.path);
      if (!document) return res.status(404).json({ error: 'Файл не входит в корпус.' });
      res.sendFile(document.absolutePath, { dotfiles: 'deny' }, error => {
        if (error && !res.headersSent) res.status(404).json({ error: 'Файл не найден.' });
      });
    } catch (error) { res.status(500).json({ error: `Не удалось открыть файл: ${error.message}` }); }
  });
  app.get('/api/indexes/:strategy/chunks', async (req, res) => {
    try {
      if (!STRATEGIES.includes(req.params.strategy)) throw inputError('Неизвестная стратегия.');
      const offset = Number(req.query.offset ?? 0); const limit = Number(req.query.limit ?? 20);
      if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 1000) throw inputError('Некорректная пагинация.');
      const index = await readIndex(req.params.strategy, indexesDir);
      res.json({ strategy: index.strategy, total: index.chunks.length, offset, chunks: index.chunks.slice(offset, offset + limit).map(({ embedding: _embedding, ...chunk }) => chunk) });
    } catch (error) { res.status(error.status || (error.code === 'ENOENT' ? 404 : 500)).json({ error: error.code === 'ENOENT' ? 'Сначала постройте индекс.' : error.message }); }
  });
  app.post('/api/indexes/build', async (req, res) => {
    if (building) return res.status(409).json({ error: 'Индексация уже выполняется.' });
    const strategy = req.body?.strategy ?? 'all';
    if (strategy !== 'all' && !STRATEGIES.includes(strategy)) return res.status(400).json({ error: 'strategy должна быть all, fixed или structured.' });
    building = true;
    try { res.json(await buildIndexes({ strategy, embedder: getEmbedder(), indexesDir, manifestPath })); }
    catch (error) {
      const status = error instanceof EmbeddingConfigurationError ? 503 : error instanceof TypeError ? 400 : 502;
      res.status(status).json({ error: error instanceof EmbeddingConfigurationError ? error.message : `Не удалось построить индекс: ${error.message}` });
    } finally { building = false; }
  });
  app.delete('/api/indexes', async (_req, res) => {
    if (building) return res.status(409).json({ error: 'Нельзя удалить индексы во время индексации.' });
    try { res.json({ removed: await deleteIndexes(STRATEGIES, indexesDir) }); }
    catch (error) { res.status(500).json({ error: `Не удалось удалить индексы: ${error.message}` }); }
  });
  app.post('/api/search', async (req, res) => {
    try { res.json(await searchIndexes({ query: req.body?.query, strategy: req.body?.strategy ?? 'all', topK: req.body?.topK ?? 5, embedder: getEmbedder(), indexesDir })); }
    catch (error) {
      const status = error instanceof EmbeddingConfigurationError ? 503 : error instanceof TypeError ? 400 : error.code === 'ENOENT' ? 404 : 502;
      res.status(status).json({ error: error.code === 'ENOENT' ? 'Сначала постройте оба индекса.' : error.message });
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
  createApp().listen(port, '127.0.0.1', () => console.log(`День 21 · Индексация документов: http://127.0.0.1:${port}`));
}
