import { fileURLToPath, pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { AltegioApi, AltegioError, TOOL_NAME, inputShape, description } from './altegio.js';

import { summaryTools } from '../summary/tools.js';
import { MoneyApi, SummaryError } from '../summary/money.js';
import { SummaryScheduler } from '../summary/scheduler.js';

export function createMcpServer({ api = new AltegioApi(), scheduler } = {}) {
  const server = new McpServer({ name: 'day-18-altegio', version: '1.0.0' });
  server.registerTool(TOOL_NAME, {
    description, inputSchema: inputShape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (args) => {
    try {
      const result = await api.listServices(args);
      return { structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (error) {
      const result = { error: error instanceof AltegioError ? error.message : 'Не удалось получить услуги Altegio.' };
      return { isError: true, content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  });
  if (scheduler) {
    const handlers = { summary_schedule_set: args => scheduler.set(args), summary_schedule_status: () => scheduler.status(), summary_schedule_pause: () => scheduler.pause(), summary_run_now: args => scheduler.run(args), summary_results: args => scheduler.results(args) };
    for (const [name, definition] of Object.entries(summaryTools)) server.registerTool(name, {
      description: definition.description, inputSchema: definition.schema.shape,
      annotations: { readOnlyHint: ['summary_schedule_status', 'summary_results'].includes(name), destructiveHint: false, openWorldHint: true },
    }, async args => {
      try { const result = await handlers[name](args); return { structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result) }] }; }
      catch (error) { return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: error instanceof SummaryError ? error.message : 'Ошибка хранилища или планировщика сводок.' }) }] }; }
    });
    server.registerTool('_summary_clear_history', { inputSchema: {}, annotations: { readOnlyHint: false, destructiveHint: true } }, async () => {
      try {
        const result = await scheduler.clearHistory();
        return { structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch { return { isError: true, content: [{ type: 'text', text: 'Не удалось очистить историю сборов.' }] }; }
    });
    // Internal lifecycle call, deliberately absent from the agent's allowlist.
    server.registerTool('_summary_shutdown', { inputSchema: {} }, async () => {
      await scheduler.stop();
      return { content: [{ type: 'text', text: '{}' }] };
    });
  }
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // stdout is reserved for the MCP protocol. Never log credentials.
  const api = new AltegioApi();
  const scheduler = await new SummaryScheduler({ api: new MoneyApi(api), file: process.env.SUMMARY_STORE_PATH || fileURLToPath(new URL('../../data/summary.json', import.meta.url)) }).init();
  const server = createMcpServer({ api, scheduler });
  await server.connect(new StdioServerTransport());
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; try { await scheduler.stop(); } finally { process.exit(0); } };
  process.on('SIGTERM', stop); process.on('SIGINT', stop); process.stdin.on('end', stop);
}
