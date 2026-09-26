import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express from 'express';
import { AgentInputError, AgentConfigurationError, LlmAgent } from './LlmAgent.js';
import { McpConnection } from './mcp/client.js';
import { runPipeline } from './pipeline/runner.js';
import { defaultReportsDir, reportFilePattern } from './pipeline/files.js';
import { authorizeAltegio, listAltegioLocations, AltegioAuthError } from './AltegioAuth.js';

export function createApp({ agent, mcp = new McpConnection(), authFetch = globalThis.fetch, locationsFetch = globalThis.fetch } = {}) {
  agent ??= new LlmAgent({ apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL, mcp });
  const app = express();
  let started = false;
  let closing = false;
  let messages = [];
  let busy = false;
  let authenticated = Boolean(mcp.env?.ALTEGIO_USER_TOKEN);
  let locations = [];
  let locationsLoaded = false;
  let locationsError = null;
  const authStatus = () => ({ locations, locationsLoaded, locationsError, authenticated, partnerConfigured: Boolean(mcp.env?.ALTEGIO_PARTNER_TOKEN), locationId: mcp.env?.ALTEGIO_LOCATION_ID || null });
  async function refreshLocations() {
    try {
      const next = await listAltegioLocations({ partnerToken: mcp.env.ALTEGIO_PARTNER_TOKEN, userToken: mcp.env.ALTEGIO_USER_TOKEN, fetchImpl: locationsFetch });
      const current = mcp.env.ALTEGIO_LOCATION_ID;
      const selected = next.some(item => item.id === current) ? current : next.length === 1 ? next[0].id : null;
      if (selected !== (current || null)) { await mcp.setLocationId(selected); messages = []; }
      locations = next;
      locationsLoaded = true;
      locationsError = null;
    } catch (error) {
      locationsError = error instanceof AltegioAuthError ? error.message : 'Не удалось загрузить филиалы. Выйдите и войдите снова.';
    }
  }
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Недопустимый источник запроса.' });
    if (req.method === 'POST' && !req.is('application/json')) return res.status(415).json({ error: 'Ожидается JSON.' });
    next();
  });
  app.use(express.json({ limit: '32kb' }));
  app.get('/api/altegio/auth', (_req, res) => res.json(authStatus()));
  app.post('/api/altegio/auth', async (req, res) => {
    if (busy) return res.status(409).json({ error: 'Дождитесь завершения текущего запроса.' });
    busy = true;
    try {
      const token = await authorizeAltegio({ login: req.body?.login, password: req.body?.password, partnerToken: mcp.env?.ALTEGIO_PARTNER_TOKEN, fetchImpl: authFetch });
      await mcp.setUserToken(token);
      await mcp.setLocationId(null);
      locations = []; locationsLoaded = false; locationsError = null;
      authenticated = true;
      await refreshLocations();
      messages = [];
      res.json(authStatus());
    } catch (error) {
      res.status(error instanceof AltegioAuthError ? error.status : 502).json({ error: error instanceof AltegioAuthError ? error.message : 'Не удалось обновить подключение MCP.' });
    } finally {
      if (req.body) delete req.body.password;
      busy = false;
    }
  });
  app.delete('/api/altegio/auth', async (_req, res) => {
    if (busy) return res.status(409).json({ error: 'Дождитесь завершения текущего запроса.' });
    busy = true;
    try {
      await mcp.setUserToken(null);
      await mcp.setLocationId(null);
      locations = []; locationsLoaded = false; locationsError = null;
      authenticated = false;
      messages = [];
      res.json(authStatus());
    } catch { res.status(502).json({ error: 'Не удалось закрыть подключение MCP. Повторите выход.' }); }
    finally { busy = false; }
  });
  app.post('/api/altegio/location', async (req, res) => {
    if (!authenticated) return res.status(401).json({ error: 'Сначала войдите в Altegio.' });
    if (busy) return res.status(409).json({ error: 'Дождитесь завершения текущего запроса.' });
    const id = req.body?.locationId;
    if (typeof id !== 'string' || !locations.some(item => item.id === id)) return res.status(400).json({ error: 'Выберите доступный филиал из списка.' });
    busy = true;
    try {
      if (id !== mcp.env.ALTEGIO_LOCATION_ID) { await mcp.setLocationId(id); messages = []; }
      res.json(authStatus());
    } catch { res.status(502).json({ error: 'Не удалось переключить филиал. Повторите попытку.' }); }
    finally { busy = false; }
  });
  app.post('/api/pipeline/run', async (req, res) => {
    if (busy || closing) return res.status(409).json({ error: 'Дождитесь завершения текущего запроса.' });
    const { query, limit, format, name } = req.body ?? {};
    if ((query !== undefined && (typeof query !== 'string' || query.length > 200)) || (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100))
      || (format !== undefined && !['md', 'json'].includes(format)) || (name !== undefined && (typeof name !== 'string' || name.length > 80))) return res.status(400).json({ error: 'Некорректные параметры пайплайна.' });
    busy = true;
    try { res.json(await runPipeline(mcp, { query: query?.trim(), limit, format, name: name?.trim() })); }
    catch { res.status(502).json({ error: 'Не удалось выполнить пайплайн. Проверьте подключение MCP.' }); }
    finally { busy = false; }
  });
  // Read-only access to saved reports so the chat can link to them.
  app.get('/api/reports/:file', (req, res) => {
    const { file } = req.params;
    if (!reportFilePattern.test(file)) return res.status(400).json({ error: 'Некорректное имя отчёта.' });
    res.type(file.endsWith('.json') ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8');
    res.sendFile(file, { root: defaultReportsDir(mcp.env), dotfiles: 'deny' }, error => {
      if (error && !res.headersSent) res.status(404).json({ error: 'Отчёт не найден.' });
    });
  });
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/messages', (_req, res) => res.json({ messages }));
  app.delete('/api/messages', (_req, res) => {
    if (busy) return res.status(409).json({ error: 'Дождитесь завершения ответа.' });
    messages = [];
    res.json({ messages });
  });
  app.post('/api/chat', async (req, res) => {
    if (busy) return res.status(409).json({ error: 'Дождитесь завершения предыдущего запроса.' });
    const message = req.body?.message;
    if (typeof message !== 'string' || !message.trim() || message.length > 10_000) return res.status(400).json({ error: 'Введите сообщение от 1 до 10 000 символов.' });
    busy = true;
    try {
      const result = await agent.ask({ message: message.trim(), history: messages });
      const userMessage = { id: randomUUID(), role: 'user', text: message.trim() };
      const agentMessage = { id: randomUUID(), role: 'agent', text: result.answer, toolCalls: result.toolCalls ?? [] };
      messages.push(userMessage, agentMessage);
      res.json({ answer: result.answer, toolCalls: agentMessage.toolCalls, messages });
    } catch (error) {
      const status = error instanceof AgentInputError ? 400 : error instanceof AgentConfigurationError ? 503 : 502;
      const safe = error instanceof AgentInputError || error instanceof AgentConfigurationError;
      res.status(status).json({ error: safe ? error.message : 'Не удалось получить ответ агента. Проверьте подключение MCP и настройки OpenAI.' });
    } finally { busy = false; }
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API-маршрут не найден.' }));
  app.use(express.static(fileURLToPath(new URL('../dist', import.meta.url))));
  app.use((error, _req, res, _next) => res.status(error.type === 'entity.too.large' ? 413 : 400).json({ error: 'Некорректный запрос.' }));
  app.locals.start = async () => {
    if (started) return;
    started = true;
    if (authenticated) {
      await refreshLocations();
      if (!locationsLoaded) await mcp.setLocationId(null);
    }
    await mcp.connect();
  };
  app.locals.close = async () => { closing = true; await mcp.close(); };
  return app;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = createApp();
  await app.locals.start();
  const port = Number(process.env.PORT || 3001);
  const server = app.listen(port, '127.0.0.1', () => console.log(`День 19 · Пайплайн MCP: http://127.0.0.1:${port}`));
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), 5000);
    deadline.unref();
    server.close();
    await app.locals.close();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
