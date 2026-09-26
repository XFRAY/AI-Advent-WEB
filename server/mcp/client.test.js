import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { McpConnection, listMcpTools } from './client.js';
const fixture = fileURLToPath(new URL('../testing/mcp-fixture.js', import.meta.url));
const exec = promisify(execFile);
test('actual stdio discovery and call with mocked upstream HTTP; reuses connection', async () => {
  const mcp = new McpConnection({ serverPath: fixture });
  try {
    const tools = await mcp.listTools();
    assert.deepEqual(tools.map(tool => tool.name), ['pipeline_search', 'pipeline_summarize', 'pipeline_save_to_file']);
    assert.ok(tools[0].description);
    assert.equal(tools[0].inputSchema.properties.query.type, 'string');
    assert.equal(tools[0].inputSchema.properties.limit.default, 50);
    const client = mcp.client;
    const result = await mcp.callTool('pipeline_search', {});
    assert.equal(mcp.client, client);
    assert.equal(result.structuredContent.items[0].title, 'Тестовая стрижка');
    assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
    const error = await mcp.callTool('pipeline_search', { query: 'failure' });
    assert.equal(error.isError, true);
    await assert.rejects(mcp.callTool('unknown', {}), /Неизвестный/);
    await assert.rejects(mcp.callTool('pipeline_search', { limit: 0 }), /аргументы/);
  } finally { await mcp.close(); }
  assert.equal(mcp.client, null);
});
test('CLI discovers the real server without API keys', async () => {
  const { stdout } = await exec(process.execPath, ['server/mcp/client.js'], { timeout: 15_000 });
  assert.match(stdout, /Доступно инструментов: 3/); assert.match(stdout, /pipeline_search/);
});
test('missing server fails without hanging', async () => {
  await assert.rejects(listMcpTools({ serverPath: '/missing/day17-server.js' }), /подключиться/);
});

test('real MCP server reports absent credentials as a tool error', async () => {
  const mcp = new McpConnection({ env: {} });
  try {
    const result = await mcp.callTool('pipeline_search', {});
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /ALTEGIO_PARTNER_TOKEN/);
  } finally { await mcp.close(); }
});
