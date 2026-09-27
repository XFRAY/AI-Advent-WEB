import test from 'node:test';
import assert from 'node:assert/strict';
import { NbpRates } from './nbp.js';
const nbp = mids => new NbpRates({ fetchImpl: async (url, options) => {
  assert.equal(options.redirect, 'error');
  const code = new URL(url).pathname.split('/')[5];
  return mids[code] ? Response.json({ rates: [{ mid: mids[code], effectiveDate: mids.date?.[code] ?? '2026-09-25' }] }) : new Response('', { status: 404 });
} });
test('converts from PLN, to PLN and between two foreign currencies through PLN', async () => {
  const toEur = await nbp({ eur: 4.25 }).convert({ from: 'pln', to: 'EUR', amounts: [50, 85] });
  assert.deepEqual([toEur.from, toEur.to, toEur.rate, toEur.rateDate], ['PLN', 'EUR', 0.235294, '2026-09-25']);
  assert.deepEqual(toEur.amounts, [{ amount: 50, converted: 11.76 }, { amount: 85, converted: 20 }]);
  assert.equal((await nbp({ eur: 4.25 }).convert({ from: 'EUR', to: 'PLN', amounts: [10] })).amounts[0].converted, 42.5);
  const cross = await nbp({ eur: 4.25, usd: 4, date: { usd: '2026-09-24' } }).convert({ from: 'USD', to: 'EUR', amounts: [100] });
  assert.equal(cross.amounts[0].converted, 94.12); assert.equal(cross.rateDate, '2026-09-25');
  const same = await new NbpRates({ fetchImpl: () => assert.fail('must not fetch') }).convert({ from: 'EUR', to: 'eur', amounts: [7] });
  assert.equal(same.amounts[0].converted, 7);
});
test('unknown currency, upstream errors and timeouts become safe messages', async () => {
  await assert.rejects(nbp({}).convert({ from: 'PLN', to: 'XYZ', amounts: [1] }), /не публикует курс XYZ/);
  const fail = fetchImpl => new NbpRates({ fetchImpl }).convert({ from: 'PLN', to: 'EUR', amounts: [1] });
  await assert.rejects(fail(async () => new Response('SECRET', { status: 500 })), error => /недоступен/.test(error.message) && !error.message.includes('SECRET'));
  await assert.rejects(fail(async () => Response.json({ rates: [{ mid: 0 }] })), /некорректный курс/);
  await assert.rejects(fail(async () => new Response('not json')), /Не удалось получить/);
  await assert.rejects(fail(async () => { throw new DOMException('t', 'TimeoutError'); }), /время ожидания/);
});
