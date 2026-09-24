// A real MCP child process; only upstream HTTP is substituted.
import { createMcpServer } from '../mcp/server.js';
import { AltegioApi } from '../mcp/altegio.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
const api = new AltegioApi({ partnerToken: 'test', userToken: 'test', locationId: '123',
  fetchImpl: async () => new Response(JSON.stringify({ data: [{ type: 'service', id: '1', attributes: { title: 'Тестовая стрижка', price_min: 50, price_max: 70 } }] })),
});
const original = api.listServices.bind(api);
api.listServices = args => args.query === 'failure' ? Promise.reject(new Error('private-token')) : original(args);
await createMcpServer({ api }).connect(new StdioServerTransport());
