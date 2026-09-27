import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './index.js';
import { McpRegistry } from './mcp/registry.js';
async function start(t, agent, mcp = new McpRegistry({ env: {}, servers: {} })) {
  const app = createApp({ agent, mcp });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await app.locals.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  return (path, method = 'GET', body) => fetch(url + path, { method, headers: { 'Content-Type': 'application/json' }, ...(body !== undefined && { body: JSON.stringify(body) }) });
}
test('invalid input and server exceptions are safe and do not change history', async t => {
  const req = await start(t, { ask: async () => { throw new Error('SECRET_API_TOKEN'); } });
  assert.equal((await req('/api/chat', 'POST', { message: '' })).status, 400);
  const error = await req('/api/chat', 'POST', { message: 'Привет' });
  assert.equal(error.status, 502); assert.doesNotMatch(await error.text(), /SECRET/);
  assert.deepEqual((await (await req('/api/messages')).json()).messages, []);
  assert.equal((await req('/api/pipeline/run', 'POST', {})).status, 404);
});
test('concurrent sends and clearing cannot corrupt the conversation', async t => {
  let release, entered;
  const begun = new Promise(resolve => { entered = resolve; });
  const waiting = new Promise(resolve => { release = resolve; });
  const req = await start(t, { ask: async () => { entered(); await waiting; return { answer: 'Done', toolCalls: [] }; } });
  const first = req('/api/chat', 'POST', { message: 'One' });
  await begun;
  assert.equal((await req('/api/chat', 'POST', { message: 'Two' })).status, 409);
  assert.equal((await req('/api/messages', 'DELETE')).status, 409);
  release(); assert.equal((await first).status, 200);
});
