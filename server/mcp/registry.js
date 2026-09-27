import 'dotenv/config';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { McpCallError, McpConnection } from './connection.js';
import { altegioTools } from './servers/altegio/tools.js';
import { analyticsTools } from './servers/analytics/tools.js';
import { currencyTools } from './servers/currency/tools.js';
import { filesTools } from './servers/files/tools.js';

const path = file => fileURLToPath(new URL(file, import.meta.url));
// Each server is a separate process and receives only the variables it needs.
export const defaultServers = {
  altegio: { title: 'Altegio', description: 'Каталог услуг и цены филиала', path: path('./servers/altegio/server.js'), envKeys: ['ALTEGIO_PARTNER_TOKEN', 'ALTEGIO_USER_TOKEN', 'ALTEGIO_LOCATION_ID'], tools: altegioTools },
  analytics: { title: 'Analytics', description: 'Статистика цен', path: path('./servers/analytics/server.js'), envKeys: [], tools: analyticsTools },
  currency: { title: 'Currency', description: 'Курсы валют НБП', path: path('./servers/currency/server.js'), envKeys: [], tools: currencyTools },
  files: { title: 'Files', description: 'Отчёты на диске', path: path('./servers/files/server.js'), envKeys: ['REPORTS_DIR'], tools: filesTools },
};

// Aggregates tools of several MCP servers and routes each call to the server that announced the tool.
export class McpRegistry {
  constructor({ env = process.env, servers = defaultServers, timeoutMs } = {}) {
    this.servers = servers;
    this.connections = Object.fromEntries(Object.entries(servers).map(([name, server]) => [name, new McpConnection({
      name, serverPath: server.path, tools: server.tools, timeoutMs,
      env: Object.fromEntries(server.envKeys.filter(key => env[key]).map(key => [key, env[key]])),
    })]));
    this.routes = new Map();
    this.errors = {};
  }
  get env() { return Object.assign({}, ...Object.values(this.connections).map(connection => connection.env)); }
  // Credentials belong to the altegio server only: other servers keep running.
  async setAltegioEnv(key, value) {
    const altegio = this.connections.altegio;
    if (!altegio) return;
    if (value) altegio.env[key] = String(value);
    else delete altegio.env[key];
    await altegio.close();
  }
  setUserToken(token) { return this.setAltegioEnv('ALTEGIO_USER_TOKEN', token); }
  setLocationId(locationId) { return this.setAltegioEnv('ALTEGIO_LOCATION_ID', locationId); }
  async connect() {
    await Promise.allSettled(Object.values(this.connections).map(connection => connection.connect()));
  }
  // A failed server is reported in errors; tools of the others stay available.
  async listTools() {
    const names = Object.keys(this.connections);
    const settled = await Promise.allSettled(names.map(name => this.connections[name].listTools()));
    const routes = new Map(), tools = [], errors = {};
    settled.forEach((result, index) => {
      const server = names[index];
      if (result.status === 'rejected') { errors[server] = result.reason instanceof McpCallError ? result.reason.message : `MCP-сервер ${server} недоступен.`; return; }
      for (const tool of result.value) {
        if (routes.has(tool.name)) throw new McpCallError(`Инструмент ${tool.name} объявлен серверами ${routes.get(tool.name)} и ${server}.`);
        routes.set(tool.name, server);
        tools.push({ server, name: tool.name, description: tool.description, inputSchema: tool.inputSchema });
      }
    });
    Object.assign(this, { routes, errors });
    return tools;
  }
  route(name) { return this.routes.get(name) ?? null; }
  async callTool(name, args) {
    if (!this.routes.has(name)) await this.listTools();
    const server = this.route(name);
    if (!server) throw new McpCallError('Неизвестный инструмент.');
    return this.connections[server].callTool(name, args);
  }
  async status() {
    let tools = [];
    try { tools = await this.listTools(); } catch {}
    return Object.entries(this.servers).map(([name, server]) => ({
      name, title: server.title, description: server.description,
      connected: !this.errors[name] && Boolean(this.connections[name].client), error: this.errors[name] ?? null,
      tools: tools.filter(tool => tool.server === name).map(tool => tool.name),
    }));
  }
  async close() {
    await Promise.all(Object.values(this.connections).map(connection => connection.close()));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const registry = new McpRegistry();
  try {
    const tools = await registry.listTools();
    for (const name of Object.keys(registry.servers)) {
      const own = tools.filter(tool => tool.server === name);
      console.log(registry.errors[name] ? `✗ ${name}: ${registry.errors[name]}` : `✓ ${name}: ${own.map(tool => tool.name).join(', ')}`);
    }
    console.log(`Серверов: ${Object.keys(registry.servers).length}, инструментов: ${tools.length}`);
    if (Object.keys(registry.errors).length) process.exitCode = 1;
  } catch (error) {
    console.error(`Ошибка MCP: ${error instanceof McpCallError ? error.message : 'не удалось получить список инструментов.'}`);
    process.exitCode = 1;
  } finally { await registry.close(); }
}
