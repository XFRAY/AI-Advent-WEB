import 'dotenv/config';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toolDefinitions } from '../summary/tools.js';

const defaultServerPath = fileURLToPath(new URL('./server.js', import.meta.url));
export class McpConnection {
  constructor({ serverPath = defaultServerPath, env = process.env, timeoutMs = 30_000 } = {}) {
    Object.assign(this, { serverPath, timeoutMs });
    // Explicit allowlist: the MCP child does not need the OpenAI key.
    this.env = Object.fromEntries(['ALTEGIO_PARTNER_TOKEN', 'ALTEGIO_USER_TOKEN', 'ALTEGIO_LOCATION_ID', 'SUMMARY_STORE_PATH'].filter(key => env[key]).map(key => [key, env[key]]));
    this.client = null;
    this.pending = null;
  }
  async setUserToken(token) {
    await this.close();
    if (token) this.env.ALTEGIO_USER_TOKEN = token;
    else delete this.env.ALTEGIO_USER_TOKEN;
  }
  async setLocationId(locationId) {
    if (this.client && this.hasScheduler && this.env.ALTEGIO_LOCATION_ID && String(locationId || '') !== this.env.ALTEGIO_LOCATION_ID) await this.callTool('summary_schedule_pause', {});
    await this.close();
    if (locationId) this.env.ALTEGIO_LOCATION_ID = String(locationId);
    else delete this.env.ALTEGIO_LOCATION_ID;
  }
  async connect() {
    if (this.client) return this.client;
    if (this.pending) return this.pending;
    this.pending = this.open();
    try { return await this.pending; } finally { this.pending = null; }
  }
  async open() {
    const transport = new StdioClientTransport({ command: process.execPath, args: [this.serverPath], env: this.env, stderr: 'pipe' });
    const client = new Client({ name: 'day-18-client', version: '1.0.0' });
    transport.stderr?.on('data', () => {});
    try {
      await client.connect(transport, { timeout: 10_000 });
      this.transport = transport;
      this.client = client;
      client.onclose = () => { if (this.client === client) this.client = null; };
      this.hasScheduler = (await client.listTools()).tools.some(tool => tool.name === '_summary_shutdown');
      return client;
    } catch {
      await client.close().catch(() => {});
      await transport.close().catch(() => {});
      throw new Error('Не удалось подключиться к MCP-серверу.');
    }
  }
  async listTools() {
    const client = await this.connect();
    const result = [];
    let cursor;
    const deadline = Date.now() + this.timeoutMs;
    do {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('Истекло время получения инструментов MCP.');
      const page = await client.listTools(cursor ? { cursor } : {}, { timeout: remaining });
      result.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);
    return result.filter(tool => Object.hasOwn(toolDefinitions, tool.name));
  }
  async callTool(name, args) {
    if (!Object.hasOwn(toolDefinitions, name)) throw new Error('Неизвестный инструмент.');
    const parsed = toolDefinitions[name].schema.safeParse(args);
    if (!parsed.success) throw new Error('Некорректные аргументы инструмента.');
    const client = await this.connect();
    return client.callTool({ name, arguments: parsed.data }, undefined, { timeout: name.startsWith('summary_') ? Math.max(this.timeoutMs, 60_000) : this.timeoutMs });
  }
  async clearSummaryHistory() {
    const client = await this.connect();
    const result = await client.callTool({ name: '_summary_clear_history', arguments: {} }, undefined, { timeout: 60_000 });
    if (result.isError) throw new Error('Не удалось очистить историю сборов.');
    return result.structuredContent;
  }
  async close() {
    if (this.pending) await this.pending.catch(() => {});
    if (this.client && this.hasScheduler) await this.client.callTool({ name: '_summary_shutdown', arguments: {} }, undefined, { timeout: 60_000 });
    await this.client?.close();
    await this.transport?.close();
    this.client = null;
    this.transport = null;
  }
}
export async function listMcpTools(options) {
  const connection = new McpConnection(options);
  try { return await connection.listTools(); } finally { await connection.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const directory = await mkdtemp(join(tmpdir(), 'altegio-discovery-'));
  try {
    const tools = await listMcpTools({ serverPath: process.argv[2], env: { SUMMARY_STORE_PATH: join(directory, 'summary.json') } });
    console.log('MCP-соединение установлено.');
    console.log(`Доступно инструментов: ${tools.length}`);
    console.log(JSON.stringify(tools, null, 2));
  } catch {
    console.error('Ошибка MCP: не удалось получить список инструментов.');
    process.exitCode = 1;
  } finally { await rm(directory, { recursive: true, force: true }); }
}
