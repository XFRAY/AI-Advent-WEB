import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeAltegio, listAltegioLocations } from './AltegioAuth.js';
const credentials = { login: ' user@example.com ', password: ' password ', partnerToken: 'PARTNER_SECRET' };
test('authorization uses documented endpoint and preserves password whitespace', async () => {
  const token = await authorizeAltegio({ ...credentials, fetchImpl: async (url, request) => {
    assert.equal(url, 'https://api.alteg.io/api/v1/auth');
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.Authorization, 'Bearer PARTNER_SECRET');
    assert.equal(request.headers.Accept, 'application/vnd.api.v2+json');
    assert.deepEqual(JSON.parse(request.body), { login: 'user@example.com', password: ' password ' });
    return Response.json({ success: true, data: { user_token: 'USER_SECRET' } }, { status: 201 });
  } });
  assert.equal(token, 'USER_SECRET');
});
test('rejects missing credentials or configuration without sending request', async () => {
  for (const change of [{ login: '' }, { password: '' }, { password: 123 }, { partnerToken: '' }]) {
    await assert.rejects(authorizeAltegio({ ...credentials, ...change, fetchImpl: () => assert.fail('must not fetch') }));
  }
});
test('errors, invalid responses and timeout never expose upstream body', async () => {
  for (const status of [400, 401, 403, 422, 429, 500]) {
    await assert.rejects(authorizeAltegio({ ...credentials, fetchImpl: async () => new Response('PASSWORD_SECRET', { status }) }), e => !e.message.includes('SECRET'));
  }
  for (const body of [{}, { data: { user_token: '' } }, { success: false, data: { user_token: 'SECRET' } }]) {
    await assert.rejects(authorizeAltegio({ ...credentials, fetchImpl: async () => Response.json(body) }), /не вернул токен/);
  }
  await assert.rejects(authorizeAltegio({ ...credentials, fetchImpl: async () => { throw new Error('PARTNER_SECRET'); } }), e => !e.message.includes('SECRET'));
  await assert.rejects(authorizeAltegio({ ...credentials, fetchImpl: async () => { throw new DOMException('SECRET', 'TimeoutError'); } }), e => e.status === 504);
});

test('locations pagination uses authenticated my=1 and returns only display fields', async () => {
  let calls = 0;
  const result = await listAltegioLocations({ partnerToken: 'partner', userToken: 'user', pageSize: 1, fetchImpl: async (url, options) => {
    assert.equal(url.pathname, '/api/v1/companies');
    assert.equal(url.searchParams.get('my'), '1');
    assert.equal(url.searchParams.get('count'), '1');
    assert.equal(url.searchParams.get('page'), String(++calls));
    assert.equal(options.headers.Authorization, 'Bearer partner, User user');
    return Response.json({ data: calls === 1 ? [{ id: 1, title: 'First', address: 'Street', private: 'secret' }] : [] });
  } });
  assert.equal(calls, 2);
  assert.deepEqual(result, [{ id: '1', title: 'First', address: 'Street' }]);
});
test('locations errors, bad data and repeated pages are safely rejected', async () => {
  for (const body of [{}, { data: [null] }, { data: [{ id: 0, title: 'Bad' }] }, { success: false, data: [] }]) {
    await assert.rejects(listAltegioLocations({ fetchImpl: async () => Response.json(body) }), /некорректный список/);
  }
  await assert.rejects(listAltegioLocations({ pageSize: 1, fetchImpl: async () => Response.json({ data: [{ id: 1, title: 'Duplicate' }] }) }), /некорректный список/);
  await assert.rejects(listAltegioLocations({ fetchImpl: async () => { throw new Error('SECRET'); } }), e => !e.message.includes('SECRET'));
});
