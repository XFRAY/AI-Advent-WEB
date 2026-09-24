import { createMcpServer } from '../mcp/server.js';
import { AltegioApi } from '../mcp/altegio.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
const api = new AltegioApi({ fetchImpl: async (_url, options) => {
  if (options.headers.Authorization !== 'Bearer PARTNER_SECRET, User USER_SECRET') return new Response('', { status: 401 });
  return Response.json({ data: [{ type: 'service', id: '1', attributes: { title: 'Авторизованная услуга' } }] });
} });
await createMcpServer({ api }).connect(new StdioServerTransport());
