import test from 'node:test';
import assert from 'node:assert/strict';
import { AltegioApi, inputSchema } from './altegio.js';
const service = (id, title, attrs = {}) => ({ type: 'service', id: String(id), attributes: { title, ...attrs } });
const make = (fetchImpl, extra = {}) => new AltegioApi({ partnerToken: 'secret-partner', userToken: 'secret-user', locationId: '123', fetchImpl, ...extra });
const json = data => new Response(JSON.stringify(data));

test('validates inputs and applies default limit', () => {
  assert.equal(inputSchema.parse({}).limit, 20);
  for (const args of [{ limit: 0 }, { limit: 101 }, { limit: 1.5 }, { query: 2 }, { locationId: 8 }]) assert.equal(inputSchema.safeParse(args).success, false);
});
test('V2 headers, pagination, case-insensitive search and truncation', async () => {
  const pages = [[service(1, 'Other'), service(2, 'СТРИЖКА', { price_min: 0, price_max: '80' })], [service(3, 'Стрижка 2'), service(4, 'Other')]];
  let calls = 0;
  const api = make(async (url, options) => {
    calls++;
    assert.equal(url.pathname, '/api/v2/locations/123/services');
    assert.equal(url.searchParams.get('page'), String(calls));
    assert.equal(options.headers.Accept, 'application/vnd.api.v2+json');
    assert.equal(options.headers.Authorization, 'Bearer secret-partner, User secret-user');
    return json({ data: pages[calls - 1] });
  }, { pageSize: 2 });
  const result = await api.listServices({ query: 'стрижка', limit: 1 });
  assert.equal(calls, 2); assert.equal(result.truncated, true);
  assert.deepEqual(result.services, [{ id: '2', title: 'СТРИЖКА', price_min: 0, price_max: 80, currency: null }]);
});
test('reads linked location prices, never another location price', async () => {
  const item = service(1, 'Услуга');
  item.relationships = { company_links: { data: [{ type: 'link', id: 'a' }, { type: 'link', id: 'b' }] } };
  const result = await make(async () => json({ data: [item], included: [
    { type: 'link', id: 'a', attributes: { company_id: 999, price_min: 1 } },
    { type: 'link', id: 'b', attributes: { company_id: 123, price_min: 40, price_max: 50, currency: 'PLN' } },
  ] })).listServices({});
  assert.equal(result.services[0].price_min, 40); assert.equal(result.services[0].currency, 'PLN');
});
test('empty results and absent prices', async () => {
  assert.deepEqual((await make(async () => json({ data: [] })).listServices({})).services, []);
  const result = await make(async () => json({ data: [service(1, 'Test')] })).listServices({});
  assert.equal(result.services[0].price_min, null); assert.equal(result.truncated, false);
});
test('an exactly full page is followed by the next page', async () => {
  let calls = 0;
  const result = await make(async () => json({ data: ++calls === 1 ? [service(1, 'One')] : [] }), { pageSize: 1 }).listServices({ limit: 1 });
  assert.equal(calls, 2); assert.equal(result.truncated, false);
});
test('errors do not reveal HTTP body or credentials', async () => {
  for (const status of [401, 403, 404, 429, 500]) {
    await assert.rejects(make(async () => new Response('secret-partner', { status })).listServices({}), error => !error.message.includes('secret-partner'));
  }
  await assert.rejects(make(async () => { throw new Error('secret-user'); }).listServices({}), /корректный ответ/);
  await assert.rejects(make(async () => new Response('not json')).listServices({}), /корректный ответ/);
  await assert.rejects(make(async () => json({ data: {} })).listServices({}), /некорректный каталог/);
  await assert.rejects(make(async () => json({ data: [null] })).listServices({}), /некорректную услугу/);
  await assert.rejects(make(async () => json({ data: [service(1, 'x')] }), { pageSize: 1 }).listServices({}), /повторил страницу/);
  await assert.rejects(make(async () => { throw new DOMException('timeout', 'TimeoutError'); }).listServices({}), /время ожидания/);
  await assert.rejects(make(() => assert.fail('must not fetch'), { partnerToken: '' }).listServices({}), /Настройте/);
});

test('Russian query receives Polish catalog candidates without needing previous history', async () => {
  const api = make(async () => json({ data: [service(1, 'Manicure hybrydowy', { price_min: 185 }), service(2, 'Pedicure hybryda')] }));
  const result = await api.listServices({ query: 'маникюр', limit: 100 });
  assert.equal(result.searchMode, 'catalog_fallback');
  assert.equal(result.query, 'маникюр');
  assert.equal(result.services[0].title, 'Manicure hybrydowy');
  assert.equal(result.services[0].price_min, 185);
  assert.equal(result.truncated, false);
  assert.match(result.searchHint, /кандидаты/);
});
test('fallback respects limit and signals incomplete candidate list', async () => {
  const result = await make(async () => json({ data: [service(1, 'Manicure'), service(2, 'Pedicure')] })).listServices({ query: 'маникюр', limit: 1 });
  assert.equal(result.services.length, 1); assert.equal(result.truncated, true);
});
test('exact matches on later pages take precedence over fallback candidates', async () => {
  let page = 0;
  const result = await make(async () => json({ data: ++page === 1 ? [service(1, 'Manicure')] : page === 2 ? [service(2, 'Маникюр')] : [] }), { pageSize: 1 }).listServices({ query: 'маникюр' });
  assert.equal(result.searchMode, undefined);
  assert.deepEqual(result.services.map(s => s.id), ['2']);
});
