import test from 'node:test';
import assert from 'node:assert/strict';
import { priceStats } from './stats.js';
const items = [
  { title: 'Стрижка мужская', price_min: 50, price_max: 70, currency: 'PLN' },
  { title: 'Стрижка детская', price_min: 30, price_max: null, currency: 'PLN' },
  { title: 'Haircut', price_min: 20, price_max: 25, currency: 'EUR' },
  { title: 'Стрижка машинкой', price_min: null, price_max: null, currency: null },
];
test('groups prices by currency and keeps null prices out of statistics', () => {
  const stats = priceStats(items);
  assert.deepEqual([stats.count, stats.priced, stats.unpriced], [4, 3, 1]);
  const pln = stats.byCurrency.find(group => group.currency === 'PLN');
  assert.deepEqual([pln.count, pln.priceMin, pln.priceMax, pln.averageMin], [2, 30, 70, 40]);
  assert.equal(pln.cheapest[0].title, 'Стрижка детская'); assert.equal(pln.mostExpensive[0].title, 'Стрижка мужская');
  assert.equal(stats.byCurrency.find(group => group.currency === 'EUR').priceMax, 25);
  assert.match(stats.text, /Услуг: 4, с ценой: 3/); assert.match(stats.text, /Без цены: 1/);
});
test('price_max below price_min is treated as missing upper price; missing currency is its own group', () => {
  const [group] = priceStats([
    { title: 'Zdobienia', price_min: 15, price_max: 0 },
    { title: 'French', price_min: 30, price_max: 30, currency: null },
  ]).byCurrency;
  assert.deepEqual([group.currency, group.priceMin, group.priceMax], [null, 15, 30]);
  assert.equal(group.mostExpensive[0].title, 'French');
});
