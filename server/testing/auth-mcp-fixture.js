import { createAltegioServer } from '../mcp/servers/altegio/server.js';
import { AltegioApi } from '../mcp/servers/altegio/api.js';
import { serveStdio } from '../mcp/servers/shared.js';
const api = new AltegioApi({ fetchImpl: async (_url, options) => {
  if (options.headers.Authorization !== 'Bearer PARTNER_SECRET, User USER_SECRET') return new Response('', { status: 401 });
  return Response.json({ data: [{ type: 'service', id: '1', attributes: { title: 'Авторизованная услуга' } }] });
} });
await serveStdio(createAltegioServer({ api }));
