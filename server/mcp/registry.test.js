import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { McpRegistry, defaultServers } from './registry.js';
import { testServers } from '../testing/servers.js';
const exec = promisify(execFile);
async function registry(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'registry-'));
  const mcp = new McpRegistry({ env: { REPORTS_DIR: dir, ALTEGIO_USER_TOKEN: 'x', OPENAI_API_KEY: 'SECRET' }, servers: testServers(), ...options });
  t.after(async () => { await mcp.close(); await rm(dir, { recursive: true, force: true }); });
  return mcp;
}
test('discovers tools of four stdio servers and routes each call to its owner', async t => {
  const mcp = await registry(t);
  const tools = await mcp.listTools();
  assert.deepEqual(tools.map(tool => [tool.server, tool.name]), [
    ['altegio', 'altegio_search_services'], ['analytics', 'analytics_price_stats'], ['currency', 'currency_convert'],
    ['files', 'files_save_report'], ['files', 'files_list_reports'], ['files', 'files_read_report'],
  ]);
  assert.equal(tools[0].inputSchema.properties.query.type, 'string');
  // Each process only gets its own variables.
  assert.deepEqual(Object.keys(mcp.connections.altegio.env), ['ALTEGIO_USER_TOKEN']);
  assert.deepEqual(Object.keys(mcp.connections.files.env), ['REPORTS_DIR']);
  assert.deepEqual(mcp.connections.currency.env, {});
  const search = (await mcp.callTool('altegio_search_services', { query: 'стрижка' })).structuredContent;
  assert.equal(search.services.length, 3);
  const stats = (await mcp.callTool('analytics_price_stats', { items: search.services })).structuredContent;
  assert.deepEqual([stats.count, stats.byCurrency[0].priceMin], [3, 30]);
  const converted = (await mcp.callTool('currency_convert', { from: 'PLN', to: 'EUR', amounts: [85] })).structuredContent;
  assert.equal(converted.amounts[0].converted, 20);
  const saved = (await mcp.callTool('files_save_report', { title: 'T', markdown: stats.text, name: 'r' })).structuredContent;
  assert.equal(saved.file, 'r.md');
  assert.deepEqual((await mcp.callTool('files_list_reports', {})).structuredContent.reports.map(item => item.file), ['r.md']);
  assert.deepEqual([...mcp.routes.values()], ['altegio', 'analytics', 'currency', 'files', 'files', 'files']);
});
test('unknown tools and invalid arguments are rejected before reaching a server; tool errors stay safe', async t => {
  const mcp = await registry(t);
  await assert.rejects(mcp.callTool('pipeline_search', {}), /Неизвестный/);
  await assert.rejects(mcp.callTool('currency_convert', { from: 'PLN', to: 'EUR', amounts: [] }), /аргументы.*amounts/);
  assert.equal(mcp.connections.currency.client !== null, true);
  const failed = await mcp.callTool('altegio_search_services', { query: 'failure' });
  assert.equal(failed.isError, true); assert.doesNotMatch(failed.content[0].text, /private-token/);
  const unknown = await mcp.callTool('currency_convert', { from: 'PLN', to: 'XYZ', amounts: [1] });
  assert.match(unknown.content[0].text, /не публикует курс XYZ/);
});
test('a failed server does not hide the others; duplicate tool names are refused', async t => {
  const broken = await registry(t, { servers: testServers({ currency: { ...defaultServers.currency, path: '/missing/server.js' } }) });
  const tools = await broken.listTools();
  assert.equal(tools.some(tool => tool.server === 'currency'), false);
  assert.equal(tools.length, 5); assert.match(broken.errors.currency, /currency/);
  const status = await broken.status();
  assert.deepEqual(status.map(item => [item.name, item.connected]), [['altegio', true], ['analytics', true], ['currency', false], ['files', true]]);
  const duplicate = await registry(t, { servers: { analytics: defaultServers.analytics, copy: defaultServers.analytics } });
  await assert.rejects(duplicate.listTools(), /analytics_price_stats объявлен серверами analytics и copy/);
});
test('changing Altegio credentials restarts only the altegio server', async t => {
  const mcp = await registry(t);
  await mcp.listTools();
  const [altegio, files] = [mcp.connections.altegio.client, mcp.connections.files.client];
  await mcp.setUserToken('new');
  assert.equal(mcp.connections.altegio.client, null); assert.equal(mcp.connections.altegio.env.ALTEGIO_USER_TOKEN, 'new');
  assert.equal(mcp.connections.files.client, files);
  await mcp.setLocationId(null);
  assert.equal(mcp.env.ALTEGIO_LOCATION_ID, undefined);
  await mcp.callTool('altegio_search_services', {});
  assert.notEqual(mcp.connections.altegio.client, altegio);
});
test('CLI lists every real server without API keys', async () => {
  const { stdout } = await exec(process.execPath, ['server/mcp/registry.js'], { timeout: 20_000 });
  for (const name of ['altegio', 'analytics', 'currency', 'files']) assert.match(stdout, new RegExp(`✓ ${name}:`));
  assert.match(stdout, /Серверов: 4, инструментов: 6/);
});
