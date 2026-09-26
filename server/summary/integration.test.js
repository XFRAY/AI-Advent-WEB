import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { McpConnection } from '../mcp/client.js';
import { createApp } from '../index.js';
import { LlmAgent } from '../LlmAgent.js';
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'summary-integration-'));
  const file = join(directory, 'state.json');
  const env = { ALTEGIO_PARTNER_TOKEN: 'partner', ALTEGIO_USER_TOKEN: 'user', ALTEGIO_LOCATION_ID: '1', SUMMARY_STORE_PATH: file };
  const mcp = new McpConnection({ serverPath: fileURLToPath(new URL('../testing/summary-mcp-fixture.js', import.meta.url)), env });
  t.after(async () => { await mcp.close(); await rm(directory, { recursive: true, force: true }); });
  return { mcp, file };
}
test('stdio tools persist aggregates, pause on location change and restart cleanly', async t => {
  const { mcp, file } = await fixture(t);
  const names = (await mcp.listTools()).map(tool => tool.name);
  assert.equal(names.length, 6); assert.ok(!names.includes('_summary_shutdown'));
  const first = await mcp.callTool('summary_schedule_set', { intervalMinutes: 1 });
  assert.equal(first.structuredContent.run.summary.net, '80.05');
  assert.equal(first.structuredContent.schedule.locationId, '1');
  await mcp.close();
  const restored = (await mcp.callTool('summary_schedule_status', {})).structuredContent;
  assert.equal(restored.latest.net, '80.05'); assert.equal(restored.schedule.enabled, true);
  await mcp.setLocationId('2');
  const changed = (await mcp.callTool('summary_schedule_status', {})).structuredContent;
  assert.equal(changed.schedule.enabled, false);
  await mcp.callTool('summary_schedule_set', { intervalMinutes: 5 });
  assert.equal((await mcp.callTool('summary_schedule_status', {})).structuredContent.schedule.locationId, '2');
  assert.doesNotMatch(await readFile(file, 'utf8'), /partner|userToken/);
});
test('backend starts MCP before requests and overdue persisted schedule runs without a browser', async t => {
  const { mcp, file } = await fixture(t);
  await mcp.callTool('summary_schedule_set', { intervalMinutes: 1 }); await mcp.close();
  const saved = JSON.parse(await readFile(file, 'utf8')); saved.schedule.nextRunAt = '2020-01-01T00:00:00.000Z'; await writeFile(file, JSON.stringify(saved));
  const app = createApp({ mcp, agent: { ask: async () => ({ answer: 'Hi' }) }, locationsFetch: async () => Response.json({ data: [{ id: 1, title: 'Test' }] }) });
  t.after(() => app.locals.close());
  await app.locals.start();
  let state;
  for (let i = 0; i < 40; i++) {
    state = JSON.parse(await readFile(file, 'utf8'));
    if (state.runs.length === 2 && state.runs[1].status === 'success') break;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal(state.runs.length, 2); assert.equal(state.runs[1].status, 'success');
});
test('HTTP controls and agent use the same real MCP scheduler; logout pauses it', async t => {
  const { mcp } = await fixture(t); let llmCalls = 0;
  const agent = new LlmAgent({ mcp, client: { responses: { create: async () => ++llmCalls === 1 ? { output: [{ type: 'function_call', name: 'summary_schedule_set', arguments: '{"intervalMinutes":5}', call_id: 'schedule-1' }] } : { output: [], output_text: 'Сбор включён каждые 5 минут.' } } } });
  const app = createApp({ mcp, agent });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await app.locals.close(); });
  const request = async (path, body, method = body ? 'POST' : 'GET') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/${path}`, { method, ...(body && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
  const chat = await request('chat', { message: 'Собирай сводку каждые 5 минут' });
  assert.equal(chat.status, 200); assert.equal(chat.body.toolCalls[0].name, 'summary_schedule_set');
  assert.equal((await request('summary/status')).body.schedule.intervalMinutes, 5);
  assert.equal((await request('summary/run', {})).body.run.summary.net, '80.05');
  assert.equal((await request('summary/results')).body.runs.length, 2);
  assert.notEqual((await request('summary/schedule', { intervalMinutes: 0 })).status, 200);
  const cleared = await request('history', undefined, 'DELETE');
  assert.equal(cleared.status, 200); assert.deepEqual(cleared.body.messages, []);
  assert.equal(cleared.body.summary.latest, null);
  assert.equal(cleared.body.summary.schedule, null);
  assert.deepEqual((await request('summary/results')).body.runs, []);
  assert.deepEqual((await request('messages')).body.messages, []);
  // Altegio login survives the wipe: a manual run still collects.
  assert.equal((await request('summary/run', {})).body.run.status, 'success');
  assert.equal((await request('summary/schedule', { intervalMinutes: 5 })).body.schedule.enabled, true);
  await request('altegio/auth', undefined, 'DELETE');
  assert.equal((await request('summary/status')).body.schedule.enabled, false);
});
