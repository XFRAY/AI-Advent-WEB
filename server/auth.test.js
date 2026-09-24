import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { McpConnection } from './mcp/client.js';
import { createApp } from './index.js';
async function start(t, { authFetch, agent, locationsFetch = async () => Response.json({ data: [{ id: 123, title: 'Основной филиал' }] }) } = {}) {
  const mcp = new McpConnection({ env: { ALTEGIO_PARTNER_TOKEN: 'PARTNER_SECRET', ALTEGIO_LOCATION_ID: '123' }, serverPath: fileURLToPath(new URL('./testing/auth-mcp-fixture.js', import.meta.url)) });
  const app = createApp({ mcp, authFetch, locationsFetch, agent: agent ?? { ask: async () => ({ answer: 'Hi', toolCalls: [] }) } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await app.locals.close(); });
  const req = async (method, body, path = '/api/altegio/auth') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body && { body: JSON.stringify(body) }) });
    const data = await response.json();
    assert.doesNotMatch(JSON.stringify(data), /USER_SECRET|PARTNER_SECRET|PASSWORD_SECRET/);
    return { status: response.status, data };
  };
  return { mcp, req };
}
test('login changes credentials of actual MCP child; status and logout never expose tokens', async t => {
  const { mcp, req } = await start(t, { authFetch: async () => Response.json({ data: { user_token: 'USER_SECRET' } }, { status: 201 }) });
  assert.equal((await req('GET')).data.authenticated, false);
  await mcp.listTools(); const oldClient = mcp.client;
  await req('POST', { message: 'Old history' }, '/api/chat');
  const login = await req('POST', { login: 'person', password: 'PASSWORD_SECRET' });
  assert.equal(login.status, 200); assert.equal(login.data.authenticated, true);
  assert.deepEqual((await req('GET', null, '/api/messages')).data.messages, []);
  assert.equal(mcp.client, null);
  const output = await mcp.callTool('altegio_list_services', {});
  assert.notEqual(mcp.client, oldClient);
  assert.equal(output.structuredContent.services[0].title, 'Авторизованная услуга');
  assert.equal((await req('GET')).data.authenticated, true);
  await req('POST', { message: 'New history' }, '/api/chat');
  assert.equal((await req('DELETE')).data.authenticated, false);
  assert.equal(mcp.env.ALTEGIO_USER_TOKEN, undefined);
  assert.equal(mcp.client, null);
  assert.deepEqual((await req('GET', null, '/api/messages')).data.messages, []);
  const afterLogout = await mcp.callTool('altegio_list_services', {});
  assert.equal(afterLogout.isError, true);
  assert.match(afterLogout.content[0].text, /Войдите/);
});
test('failed login retains existing session and never forwards upstream secrets', async t => {
  let attempt = 0;
  const { req } = await start(t, { authFetch: async () => ++attempt === 1 ? Response.json({ data: { user_token: 'USER_SECRET' } }) : new Response('PASSWORD_SECRET', { status: 401 }) });
  await req('POST', { login: 'person', password: 'PASSWORD_SECRET' });
  const result = await req('POST', { login: 'wrong', password: 'wrong' });
  assert.equal(result.status, 401); assert.equal((await req('GET')).data.authenticated, true);
});
test('auth cannot change during a chat request', async t => {
  let entered, release;
  const began = new Promise(resolve => { entered = resolve; });
  const wait = new Promise(resolve => { release = resolve; });
  const { req } = await start(t, { agent: { ask: async () => { entered(); await wait; return { answer: 'Done' }; } } });
  const chat = req('POST', { message: 'Hi' }, '/api/chat');
  await began;
  try {
    assert.equal((await req('POST', { login: 'person', password: 'PASSWORD_SECRET' })).status, 409);
    assert.equal((await req('DELETE')).status, 409);
  } finally { release(); await chat; }
});
test('chat and logout cannot race an in-flight login', async t => {
  let entered, release;
  const began = new Promise(resolve => { entered = resolve; });
  const wait = new Promise(resolve => { release = resolve; });
  const { req } = await start(t, { authFetch: async () => { entered(); await wait; return Response.json({ data: { user_token: 'USER_SECRET' } }); } });
  const login = req('POST', { login: 'person', password: 'PASSWORD_SECRET' });
  await began;
  try {
    assert.equal((await req('POST', { message: 'Hi' }, '/api/chat')).status, 409);
    assert.equal((await req('DELETE')).status, 409);
  } finally { release(); await login; }
});

const validAuth = async () => Response.json({ data: { user_token: 'USER_SECRET' } });
test('single location is selected automatically and persisted across status reads', async t => {
  const { req, mcp } = await start(t, { authFetch: validAuth });
  const login = await req('POST', { login: 'user', password: 'password' });
  assert.equal(login.data.locationId, '123');
  assert.deepEqual(login.data.locations, [{ id: '123', title: 'Основной филиал', address: '' }]);
  assert.equal(mcp.env.ALTEGIO_LOCATION_ID, '123');
  assert.equal((await req('GET')).data.locationId, '123');
});
test('multiple locations require selection; switching resets MCP and history', async t => {
  const { req, mcp } = await start(t, { authFetch: validAuth, locationsFetch: async () => Response.json({ data: [{ id: 123, title: 'Первый' }, { id: 456, title: 'Второй', address: 'Улица 2' }] }) });
  const login = await req('POST', { login: 'user', password: 'password' });
  assert.equal(login.data.locationId, null);
  assert.equal(mcp.env.ALTEGIO_LOCATION_ID, undefined);
  assert.equal((await req('POST', { locationId: '999' }, '/api/altegio/location')).status, 400);
  assert.equal((await req('POST', { locationId: {} }, '/api/altegio/location')).status, 400);
  assert.equal((await req('POST', { locationId: '123' }, '/api/altegio/location')).data.locationId, '123');
  await mcp.listTools();
  await req('POST', { message: 'Old branch' }, '/api/chat');
  const changed = await req('POST', { locationId: '456' }, '/api/altegio/location');
  assert.equal(changed.data.locationId, '456');
  assert.equal(mcp.env.ALTEGIO_LOCATION_ID, '456');
  assert.equal(mcp.client, null);
  assert.deepEqual((await req('GET', null, '/api/messages')).data.messages, []);
  await req('POST', {}, '/api/altegio/locations/refresh');
  assert.equal((await req('GET')).data.locationId, '456');
  assert.equal((await req('DELETE')).data.locations.length, 0);
  assert.equal((await req('POST', { locationId: '123' }, '/api/altegio/location')).status, 401);
});
test('no accessible locations never uses previous environment location', async t => {
  const { req, mcp } = await start(t, { authFetch: validAuth, locationsFetch: async () => Response.json({ data: [] }) });
  const login = await req('POST', { login: 'user', password: 'password' });
  assert.deepEqual(login.data.locations, []);
  assert.equal(login.data.locationsLoaded, true);
  assert.equal(login.data.locationId, null);
  assert.equal(mcp.env.ALTEGIO_LOCATION_ID, undefined);
});
test('failed locations load keeps login and can be retried without credentials', async t => {
  let calls = 0;
  const { req } = await start(t, { authFetch: validAuth, locationsFetch: async () => ++calls === 1 ? new Response('SECRET', { status: 500 }) : Response.json({ data: [{ id: 789, title: 'Recovered' }] }) });
  const login = await req('POST', { login: 'user', password: 'password' });
  assert.equal(login.data.authenticated, true);
  assert.equal(login.data.locationId, null);
  assert.ok(login.data.locationsError);
  assert.doesNotMatch(login.data.locationsError, /SECRET/);
  const refreshed = await req('POST', {}, '/api/altegio/locations/refresh');
  assert.equal(refreshed.data.locationId, '789');
  assert.equal(refreshed.data.locationsError, null);
});
test('refresh removes selection when access to that branch is gone', async t => {
  let calls = 0;
  const { req, mcp } = await start(t, { authFetch: validAuth, locationsFetch: async () => Response.json({ data: ++calls === 1 ? [{ id: 123, title: 'Old' }] : [] }) });
  await req('POST', { login: 'user', password: 'password' });
  await req('POST', { message: 'Old branch' }, '/api/chat');
  const refreshed = await req('POST', {}, '/api/altegio/locations/refresh');
  assert.equal(refreshed.data.locationId, null);
  assert.equal(mcp.env.ALTEGIO_LOCATION_ID, undefined);
  assert.deepEqual((await req('GET', null, '/api/messages')).data.messages, []);
});
