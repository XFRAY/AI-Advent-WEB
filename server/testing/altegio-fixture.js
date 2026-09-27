// A real altegio MCP child process; only upstream Altegio HTTP is substituted.
import { createAltegioServer } from '../mcp/servers/altegio/server.js';
import { AltegioApi } from '../mcp/servers/altegio/api.js';
import { serveStdio } from '../mcp/servers/shared.js';
const services = [['1', 'Стрижка мужская', 50, 70], ['2', 'Стрижка детская', 30, null], ['3', 'Окрашивание', 120, 200], ['4', 'Стрижка машинкой', null, null]];
const api = new AltegioApi({ partnerToken: 'test', userToken: 'test', locationId: '123',
  fetchImpl: async () => Response.json({ data: services.map(([id, title, price_min, price_max]) => ({ type: 'service', id, attributes: { title, price_min, price_max, currency: 'PLN' } })) }),
});
const original = api.listServices.bind(api);
api.listServices = args => args.query === 'failure' ? Promise.reject(new Error('private-token')) : original(args);
await serveStdio(createAltegioServer({ api }));
