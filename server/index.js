import 'dotenv/config';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express from 'express';
import { BENCHMARK_TASKS, createOptimizationRunner, PROFILES, publicProfile } from './OptimizationCore.js';
import { createOllamaClient } from './ollama.js';

export const MAX_PROMPT_LENGTH = 4_000;

export function createApp({ ollamaClient, runner } = {}) {
  const app = express();
  const ollama = ollamaClient ?? createOllamaClient();
  const optimization = runner ?? createOptimizationRunner({ client: ollama });
  const profiles = optimization.profiles || PROFILES;
  let running = false;

  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Недопустимый источник запроса.' });
    if (req.method === 'POST' && !req.is('application/json')) return res.status(415).json({ error: 'Ожидается JSON.' });
    next();
  });
  app.use(express.json({ limit: '32kb' }));

  app.get('/api/optimization/status', async (_req, res) => {
    const modelNames = Object.values(profiles).map(profile => profile.model);
    try {
      const status = await ollama.status(modelNames);
      res.json({ ollama: { available: true, version: status.version }, profiles: Object.fromEntries(Object.entries(profiles).map(([key, profile]) => [key, { ...publicProfile(profile), ...(status.models[profile.model] || { installed: false }) }])), running });
    } catch (error) {
      res.json({ ollama: { available: false, version: null, error: error.message }, profiles: Object.fromEntries(Object.entries(profiles).map(([key, profile]) => [key, { ...publicProfile(profile), installed: false }])), running });
    }
  });

  async function exclusive(res, action) {
    if (running) return res.status(409).json({ error: 'Сравнение уже выполняется.' });
    running = true;
    try { return res.json(await action()); }
    catch (error) { return res.status(error.code === 'OLLAMA_UNAVAILABLE' ? 503 : 502).json({ error: error.message }); }
    finally { running = false; }
  }

  app.post('/api/optimization/compare', async (req, res) => {
    const prompt = req.body?.prompt;
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > MAX_PROMPT_LENGTH) return res.status(400).json({ error: `Введите запрос от 1 до ${MAX_PROMPT_LENGTH} символов.` });
    const cleanPrompt = prompt.trim();
    return exclusive(res, async () => ({ prompt: cleanPrompt, ...(await optimization.compare(cleanPrompt)) }));
  });

  app.post('/api/optimization/benchmark', async (_req, res) => exclusive(res, async () => ({ tasks: await optimization.benchmark(BENCHMARK_TASKS) })));
  app.get('/api/health', (_req, res) => res.json({ ok: true, running }));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API-маршрут не найден.' }));
  app.use(express.static(fileURLToPath(new URL('../dist', import.meta.url))));
  app.use((error, _req, res, _next) => res.status(error.type === 'entity.too.large' ? 413 : 400).json({ error: 'Некорректный запрос.' }));
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 3001);
  createApp().listen(port, '127.0.0.1', () => console.log(`День 29 · оптимизация локальной LLM: http://127.0.0.1:${port}`));
}
