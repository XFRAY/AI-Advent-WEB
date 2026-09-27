import { AltegioApi } from './api.js';
import { altegioTools } from './tools.js';
import { createToolServer, isMain, serveStdio } from '../shared.js';

export const createAltegioServer = ({ api = new AltegioApi() } = {}) => createToolServer({
  name: 'altegio', definitions: altegioTools,
  handlers: { altegio_search_services: args => api.listServices(args) },
});
if (isMain(import.meta)) await serveStdio(createAltegioServer());
