import 'dotenv/config';
import fs from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express from 'express';
import { ChatAgent } from './ChatAgent.js';
import { ChatRepository } from './ChatRepository.js';
import { DEFAULT_RAG_SETTINGS, GroundingValidationError, RagAgent, createOpenAIGenerator, resolveRagSettings } from './RagAgent.js';
import { loadCorpus } from './indexing/corpus.js';
import { createOpenAIEmbedder, EmbeddingConfigurationError } from './indexing/embeddings.js';
import { buildIndex } from './indexing/pipeline.js';
import { readIndexSummary } from './indexing/store.js';

const evaluationPath = fileURLToPath(new URL('../corpus/evaluation.json', import.meta.url));

function envNumber(name, fallback) {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : Number(value);
}

export function readRagDefaults() {
  return resolveRagSettings({
    candidateTopK: envNumber('RAG_CANDIDATE_TOP_K', DEFAULT_RAG_SETTINGS.candidateTopK),
    resultTopK: envNumber('RAG_RESULT_TOP_K', DEFAULT_RAG_SETTINGS.resultTopK),
    similarityThreshold: envNumber('RAG_SIMILARITY_THRESHOLD', DEFAULT_RAG_SETTINGS.similarityThreshold),
  });
}

export function createApp({ embedder, generator, agent, chatAgent, chatRepository, databasePath, indexesDir, manifestPath, questionsPath = evaluationPath, ragDefaults = readRagDefaults() } = {}) {
  const app = express();
  let building = false;
  const getEmbedder = () => embedder ?? createOpenAIEmbedder();
  const getGenerator = () => generator ?? createOpenAIGenerator();
  const repository = chatRepository ?? new ChatRepository({ databasePath });
  let chatAgentInstance = chatAgent;
  const getAgent = () => agent ?? new RagAgent({ embedder: getEmbedder(), generator: getGenerator(), indexesDir, defaults: ragDefaults });
  const getChatAgent = () => {
    chatAgentInstance ??= new ChatAgent({ repository, embedder: getEmbedder(), generator: getGenerator(), indexesDir, defaults: ragDefaults });
    return chatAgentInstance;
  };

  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Недопустимый источник запроса.' });
    if (req.method === 'POST' && !req.is('application/json')) return res.status(415).json({ error: 'Ожидается JSON.' });
    next();
  });
  app.use(express.json({ limit: '16kb' }));

  app.get('/api/index', async (_req, res) => {
    try {
      const [corpus, index] = await Promise.all([loadCorpus({ manifestPath }), readIndexSummary(indexesDir)]);
      res.json({ building, corpus: corpus.stats, index, ragDefaults });
    } catch (error) {
      res.status(500).json({ error: `Не удалось прочитать базу знаний: ${error.message}` });
    }
  });

  app.post('/api/index/build', async (_req, res) => {
    if (building) return res.status(409).json({ error: 'Индексация уже выполняется.' });
    building = true;
    try {
      res.json(await buildIndex({ embedder: getEmbedder(), indexesDir, manifestPath }));
    } catch (error) {
      const status = error instanceof EmbeddingConfigurationError ? 503 : error instanceof TypeError ? 400 : 502;
      res.status(status).json({ error: error instanceof EmbeddingConfigurationError ? error.message : `Не удалось построить индекс: ${error.message}` });
    } finally {
      building = false;
    }
  });

  app.get('/api/evaluation/questions', async (_req, res) => {
    try {
      res.json({ questions: JSON.parse(await fs.readFile(questionsPath, 'utf8')) });
    } catch (error) {
      res.status(500).json({ error: `Не удалось прочитать контрольный набор: ${error.message}` });
    }
  });

  app.get('/api/documents/file', async (req, res) => {
    try {
      const corpus = await loadCorpus({ manifestPath });
      const document = corpus.documents.find(item => item.file === req.query.path);
      if (!document) return res.status(404).json({ error: 'Файл не входит в базу знаний.' });
      res.sendFile(document.absolutePath, { dotfiles: 'deny' }, error => {
        if (error && !res.headersSent) res.status(404).json({ error: 'Файл не найден.' });
      });
    } catch (error) {
      res.status(500).json({ error: `Не удалось открыть файл: ${error.message}` });
    }
  });

  app.post('/api/answer', async (req, res) => {
    try {
      res.json(await getAgent().answer(req.body?.question, req.body?.settings));
    } catch (error) {
      const message = error instanceof TypeError || error instanceof GroundingValidationError ? error.message : 'Не удалось получить ответ.';
      res.status(error instanceof TypeError ? 400 : 502).json({ error: message });
    }
  });

  app.get('/api/conversations', (_req, res) => res.json({ conversations: repository.listConversations() }));

  app.post('/api/conversations', (_req, res) => res.status(201).json({ conversation: repository.createConversation() }));

  app.get('/api/conversations/:id', (req, res) => {
    const conversation = repository.getConversation(req.params.id);
    if (!conversation) return res.status(404).json({ error: 'Диалог не найден.' });
    res.json({ conversation });
  });

  app.post('/api/conversations/:id/messages', async (req, res) => {
    try {
      const result = await getChatAgent().answer(req.params.id, req.body?.content, req.body?.settings);
      if (!result) return res.status(404).json({ error: 'Диалог не найден.' });
      res.json(result);
    } catch (error) {
      const message = error instanceof TypeError || error instanceof GroundingValidationError ? error.message : 'Не удалось получить ответ.';
      res.status(error instanceof TypeError ? 400 : 502).json({ error: message });
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
  createApp().listen(port, '127.0.0.1', () => console.log(`День 25 · RAG-чат с памятью: http://127.0.0.1:${port}`));
}
