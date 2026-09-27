import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Errors with messages that are safe to show to the model and the user.
export class McpCallError extends Error {}

// One stdio connection to one MCP server process. Arguments are validated by that server's own definitions.
export class McpConnection {
  constructor({ name, serverPath, tools, env = {}, timeoutMs = 30_000 }) {
    Object.assign(this, { name, serverPath, tools, timeoutMs });
    this.env = { ...env };
    this.client = null;
    this.transport = null;
    this.pending = null;
  }
  async connect() {
    if (this.client) return this.client;
    if (this.pending) return this.pending;
    this.pending = this.open();
    try { return await this.pending; } finally { this.pending = null; }
  }
  async open() {
    const transport = new StdioClientTransport({ command: process.execPath, args: [this.serverPath], env: this.env, stderr: 'pipe' });
    const client = new Client({ name: 'day-20-orchestrator', version: '1.0.0' });
    transport.stderr?.on('data', () => {});
    try {
      await client.connect(transport, { timeout: 10_000 });
      this.transport = transport;
      this.client = client;
      client.onclose = () => { if (this.client === client) this.client = null; };
      return client;
    } catch {
      await client.close().catch(() => {});
      await transport.close().catch(() => {});
      throw new McpCallError(`Не удалось подключиться к MCP-серверу ${this.name}.`);
    }
  }
  async listTools() {
    const client = await this.connect();
    const result = [];
    let cursor;
    const deadline = Date.now() + this.timeoutMs;
    do {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new McpCallError(`Истекло время получения инструментов сервера ${this.name}.`);
      const page = await client.listTools(cursor ? { cursor } : {}, { timeout: remaining });
      result.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);
    // Only tools this server is expected to own are exposed.
    return result.filter(tool => Object.hasOwn(this.tools, tool.name));
  }
  async callTool(name, args) {
    if (!Object.hasOwn(this.tools, name)) throw new McpCallError('Неизвестный инструмент.');
    const parsed = this.tools[name].schema.safeParse(args);
    if (!parsed.success) throw new McpCallError(`Некорректные аргументы инструмента: ${parsed.error.issues.slice(0, 3).map(issue => `${issue.path.join('.') || 'args'} — ${issue.message}`).join('; ')}.`);
    const client = await this.connect();
    try { return await client.callTool({ name, arguments: parsed.data }, undefined, { timeout: this.timeoutMs }); }
    catch { throw new McpCallError(`MCP-сервер ${this.name} не выполнил вызов.`); }
  }
  async close() {
    if (this.pending) await this.pending.catch(() => {});
    await this.client?.close();
    await this.transport?.close();
    this.client = null;
    this.transport = null;
  }
}
