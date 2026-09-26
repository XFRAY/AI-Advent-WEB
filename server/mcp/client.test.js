import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpConnection, listMcpTools } from './client.js';
const fixture = fileURLToPath(new URL('../testing/mcp-fixture.js', import.meta.url));
const exec = promisify(execFile);
test('actual stdio discovery and call with mocked upstream HTTP; reuses connection', async () => {
  const mcp = new McpConnection({ serverPath: fixture });
  try {
    const tools = await mcp.listTools();
    assert.deepEqual(tools.map(tool => tool.name), ['altegio_list_services']);
    assert.ok(tools[0].description);
    assert.equal(tools[0].inputSchema.properties.query.type, 'string');
    assert.equal(tools[0].inputSchema.properties.limit.default, 20);
    const client = mcp.client;
    const result = await mcp.callTool('altegio_list_services', {});
    assert.equal(mcp.client, client);
    assert.equal(result.structuredContent.services[0].title, 'Тестовая стрижка');
    assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
    const error = await mcp.callTool('altegio_list_services', { query: 'failure' });
    assert.equal(error.isError, true);
    await assert.rejects(mcp.callTool('unknown', {}), /Неизвестный/);
    await assert.rejects(mcp.callTool('altegio_list_services', { limit: 0 }), /аргументы/);
  } finally { await mcp.close(); }
  assert.equal(mcp.client, null);
});
test('CLI discovers the real server without API keys', async () => {
  const { stdout } = await exec(process.execPath, ['server/mcp/client.js'], { timeout: 15_000 });
  assert.match(stdout, /Доступно инструментов: 6/); assert.match(stdout, /altegio_list_services/);
});
test('missing server fails without hanging', async () => {
  await assert.rejects(listMcpTools({ serverPath: '/missing/day17-server.js' }), /подключиться/);
});

test('real MCP server reports absent credentials as a tool error', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'summary-no-credentials-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const mcp = new McpConnection({ env: { SUMMARY_STORE_PATH: join(directory, 'state.json') } });
  try {
    const result = await mcp.callTool('altegio_list_services', {});
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /ALTEGIO_PARTNER_TOKEN/);
  } finally { await mcp.close(); }
});
