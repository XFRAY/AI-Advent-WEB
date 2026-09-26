// Real MCP transport and scheduler, deterministic Altegio HTTP responses only.
import { createMcpServer } from '../mcp/server.js';
import { MoneyApi } from '../summary/money.js';
import { SummaryScheduler } from '../summary/scheduler.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
const api = new MoneyApi({ partnerToken: process.env.ALTEGIO_PARTNER_TOKEN, userToken: process.env.ALTEGIO_USER_TOKEN, locationId: process.env.ALTEGIO_LOCATION_ID, fetchImpl: async url => {
  if (url.pathname.includes('/company/')) return Response.json({ data: { title: 'Тестовый филиал', timezone_name: 'Europe/Warsaw', currency: 'PLN' } });
  return Response.json({ data: [{ id: 1, date: new Date().toISOString(), amount: '100.10' }, { id: 2, date: new Date().toISOString(), amount: '-20.05' }] });
} });
const scheduler = await new SummaryScheduler({ api, file: process.env.SUMMARY_STORE_PATH }).init();
await createMcpServer({ scheduler }).connect(new StdioServerTransport());
let stopping = false;
const stop = async () => { if (stopping) return; stopping = true; await scheduler.stop(); process.exit(0); };
process.on('SIGTERM', stop); process.stdin.on('end', stop);
