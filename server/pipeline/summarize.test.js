import test from 'node:test';
import assert from 'node:assert/strict';
import { checksum, renderMarkdown, sign, summarizeServices, toSearchResult, verify } from './summarize.js';
const now = new Date('2026-09-26T10:00:00Z');
const search = () => toSearchResult({ query: 'стрижка', truncated: false, services: [
  { id: '1', title: 'Стрижка мужская', price_min: 50, price_max: 70, currency: 'PLN' },
  { id: '2', title: 'Стрижка детская', price_min: 30, price_max: null, currency: 'PLN' },
  { id: '3', title: 'Haircut', price_min: 20, price_max: 25, currency: 'EUR' },
  { id: '4', title: 'Стрижка машинкой', price_min: null, price_max: null, currency: null },
] }, now);
test('checksum ignores key order and detects any change', () => {
  assert.equal(checksum({ a: 1, b: [1, { c: 2, d: null }] }), checksum({ b: [1, { d: null, c: 2 }], a: 1 }));
  assert.notEqual(checksum({ a: 1 }), checksum({ a: 2 }));
  const signed = sign({ value: 1 });
  assert.equal(verify(signed, 'x'), signed.checksum);
  assert.throws(() => verify({ ...signed, value: 2 }, 'x'), /повреждены/);
});
test('summary groups prices by currency and keeps null prices out of statistics', () => {
  const report = summarizeServices(search(), now);
  assert.equal(report.sourceChecksum, search().checksum);
  assert.equal(report.count, 4); assert.equal(report.priced, 3); assert.equal(report.unpriced, 1);
  const pln = report.byCurrency.find(group => group.currency === 'PLN');
  assert.deepEqual([pln.count, pln.priceMin, pln.priceMax, pln.averageMin], [2, 30, 70, 40]);
  assert.equal(pln.cheapest[0].title, 'Стрижка детская'); assert.equal(pln.mostExpensive[0].title, 'Стрижка мужская');
  assert.equal(report.byCurrency.find(group => group.currency === 'EUR').priceMax, 25);
  assert.match(report.text, /Услуг по запросу «стрижка»: 4/); assert.match(report.text, /Без цены: 1/);
  assert.equal(verify(report, 'сводки'), report.checksum);
});
test('price_max below price_min is treated as missing upper price', () => {
  const report = summarizeServices(toSearchResult({ query: '', services: [
    { id: '1', title: 'Zdobienia', price_min: 15, price_max: 0, currency: null },
    { id: '2', title: 'French', price_min: 30, price_max: 30, currency: null },
  ] }, now), now);
  const group = report.byCurrency[0];
  assert.deepEqual([group.priceMin, group.priceMax], [15, 30]); assert.equal(group.mostExpensive[0].title, 'French');
});
test('tampered search result is rejected before summarizing', () => {
  const source = search(); source.items[0].price_min = 1;
  assert.throws(() => summarizeServices(source), /повреждены/);
  const dropped = search(); dropped.items.pop();
  assert.throws(() => summarizeServices(dropped), /повреждены/);
});
test('markdown contains every service and escapes table separators', () => {
  const source = toSearchResult({ query: '', services: [{ id: '1', title: 'A | B', price_min: null, price_max: 5, currency: null }] }, now);
  const markdown = renderMarkdown(summarizeServices(source, now));
  assert.match(markdown, /# Отчёт по услугам: весь каталог/); assert.match(markdown, /\| A +B \| — \| 5 \|/); assert.match(markdown, /валюта не указана/);
});
