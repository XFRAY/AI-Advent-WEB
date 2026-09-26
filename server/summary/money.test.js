import test from 'node:test';
import assert from 'node:assert/strict';
import { MoneyApi, aggregate, localDate } from './money.js';
const now = new Date('2026-09-26T12:00:00Z');
const row = (id, amount, extra = {}) => ({ id, amount, date: '2026-09-26T10:00:00+0200', ...extra });
const options = { timezone: 'Europe/Warsaw', now, title: 'Филиал', currency: 'PLN' };
const api = fetchImpl => new MoneyApi({ partnerToken: 'PARTNER_SECRET', userToken: 'USER_SECRET', locationId: '1', fetchImpl, pageSize: 2 });
test('exact decimal arithmetic, signed amounts, zero and scientific notation', () => {
  assert.deepEqual(aggregate([row(1, '0.1'), row(2, '0.2'), row(3, '-0.05')]), { incoming: '0.30', outgoing: '0.05', net: '0.25', transactionCount: 3 });
  assert.deepEqual(aggregate([]), { incoming: '0.00', outgoing: '0.00', net: '0.00', transactionCount: 0 });
  assert.equal(aggregate([row(1, '1e-7')]).net, '0.0000001');
  assert.equal(aggregate([row(1, '99999999999999999.99'), row(2, '0.01')]).net, '100000000000000000.00');
  assert.throws(() => aggregate([row(1, null)]));
});
test('date boundaries and daylight saving use location timezone', () => {
  assert.equal(localDate(new Date('2026-09-25T23:30:00Z'), 'Europe/Warsaw'), '2026-09-26');
  assert.equal(localDate(new Date('2026-10-25T23:30:00Z'), 'Europe/Warsaw'), '2026-10-26');
  assert.equal(localDate(now, 'America/Los_Angeles'), '2026-09-26');
});
test('all pages, deleted/non-fiat exclusions, duplicate protection and no client data', async () => {
  let calls = 0;
  const service = api(async url => {
    assert.equal(url.pathname, '/api/v1/transactions/1');
    assert.equal(url.searchParams.get('start_date'), '20260926');
    assert.equal(url.searchParams.get('end_date'), '20260926');
    assert.equal(url.searchParams.get('real_money'), '1');
    assert.equal(url.searchParams.get('deleted'), '0');
    assert.equal(url.searchParams.get('page'), String(++calls));
    return Response.json({ data: [
      [row(1, '10.10', { client: { phone: 'PRIVATE' } }), row(2, '-0.20')],
      [row(3, '100', { deleted: 1 }), row(4, '100', { real_money: false })],
      [row(5, '100', { date: '2026-09-25T10:00:00+0200' })],
    ][calls - 1] });
  });
  const result = await service.collect(options);
  assert.equal(calls, 3); assert.equal(result.net, '9.90'); assert.equal(result.transactionCount, 2);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|client|SECRET/);
  await assert.rejects(api(async () => Response.json({ data: [row(1, 1), row(2, 2)] })).collect(options), /повторная/);
});
test('raw JSON decimal tokens do not lose precision and strings are untouched', async () => {
  // Verify Number is never involved, including when text contains numeric fragments.
  const service = api(async () => new Response(String.raw`{"data":[{"id":1,"date":"2026-09-26T10:00:00+0200","amount":99999999999999999.99,"comment":"123 \"amount\": 55"}]}`));
  const result = await service.collect(options);
  assert.equal(result.net, '99999999999999999.99');
});
test('partial response, wrong dates, bad amounts and HTTP errors never produce totals', async () => {
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(api(async () => new Response('SECRET', { status })).collect(options), e => !e.message.includes('SECRET'));
  }
  for (const bad of [row(1, 'bad'), row(1, 1, { date: '2026-09-26T10:00:00' }), row(1, 1, { currency: 'USD' })]) {
    await assert.rejects(api(async () => Response.json({ data: [bad] })).collect(options));
  }
  let page = 0;
  await assert.rejects(api(async () => ++page === 1 ? Response.json({ data: [row(1, 1), row(2, 1)] }) : new Response('', { status: 500 })).collect(options));
});
test('location metadata and absent currency do not invent currency', async () => {
  const service = api(async () => Response.json({ data: { title: 'Salon', timezone_name: 'Europe/Warsaw' } }));
  assert.deepEqual(await service.metadata(), { title: 'Salon', timezone: 'Europe/Warsaw', currency: null });
  service.fetchImpl = async () => Response.json({ data: [] });
  assert.equal((await service.collect({ ...options, currency: null })).currency, null);
});
