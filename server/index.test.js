import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './index.js';
import { LlmAgent } from './LlmAgent.js';
import { McpConnection } from './mcp/client.js';
import { fileURLToPath } from 'node:url';
async function start(t, agent, mcp) {
  const app = createApp({ agent, mcp });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await app.locals.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  return (path, method = 'GET', body) => fetch(url + path, { method, headers: { 'Content-Type': 'application/json' }, ...(body !== undefined && { body: JSON.stringify(body) }) });
}
test('HTTP → agent → stdio MCP → mocked HTTP → model, history and clear', async t => {
  const mcp = new McpConnection({ serverPath: fileURLToPath(new URL('./testing/mcp-fixture.js', import.meta.url)) });
  let rounds = 0;
  const client = { responses: { create: async request => {
    rounds++;
    if (rounds === 1) return { output: [{ type: 'function_call', name: 'altegio_list_services', arguments: '{}', call_id: 'one' }] };
    const output = JSON.parse(request.input.find(item => item.type === 'function_call_output').output);
    return { output: [], output_text: `${output.services[0].title}: ${output.services[0].price_min}–${output.services[0].price_max}` };
  } } };
  const req = await start(t, new LlmAgent({ mcp, client }), mcp);
  const response = await req('/api/chat', 'POST', { message: 'Какие услуги?' });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.answer, /Тестовая стрижка: 50–70/);
  assert.equal(body.toolCalls[0].status, 'success'); assert.equal(body.messages.length, 2);
  assert.doesNotMatch(JSON.stringify(body), /private-token|Authorization|partnerToken|userToken/);
  assert.deepEqual((await (await req('/api/messages')).json()).messages, body.messages);
  assert.deepEqual((await (await req('/api/messages', 'DELETE')).json()).messages, []);
  assert.equal((await req('/api/invariants')).status, 404);
});
test('invalid input and server exceptions are safe and do not change history', async t => {
  const req = await start(t, { ask: async () => { throw new Error('SECRET_API_TOKEN'); } });
  assert.equal((await req('/api/chat', 'POST', { message: '' })).status, 400);
  const error = await req('/api/chat', 'POST', { message: 'Привет' });
  assert.equal(error.status, 502); assert.doesNotMatch(await error.text(), /SECRET/);
  assert.deepEqual((await (await req('/api/messages')).json()).messages, []);
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
