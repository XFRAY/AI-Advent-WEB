import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { safeName, saveReport } from './files.js';
import { summarizeServices, toSearchResult } from './summarize.js';
const now = new Date('2026-09-26T10:00:00Z');
const report = summarizeServices(toSearchResult({ query: 'стрижка', services: [{ id: '1', title: 'Стрижка', price_min: 50, price_max: 70, currency: 'PLN' }] }, now), now);
async function directory(t) { const dir = await mkdtemp(join(tmpdir(), 'reports-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }
test('names cannot escape the reports directory', () => {
  assert.equal(safeName('../../etc/passwd'), 'etc-passwd');
  assert.equal(safeName('Отчёт Май.md'), 'отчёт-май-md');
  assert.equal(safeName('..', now), 'services-20260926100000');
  assert.equal(safeName(undefined, now), 'services-20260926100000');
});
test('saves markdown and json with private permissions and never overwrites', async t => {
  const dir = await directory(t);
  const saved = await saveReport({ dir, report, name: 'haircut', now });
  assert.deepEqual([saved.file, saved.reportChecksum], ['haircut.md', report.checksum]);
  const markdown = await readFile(join(dir, 'haircut.md'), 'utf8');
  assert.equal(Buffer.byteLength(markdown), saved.bytes); assert.match(markdown, /Стрижка \| 50 \| 70/);
  assert.equal((await stat(join(dir, 'haircut.md'))).mode & 0o777, 0o600);
  await assert.rejects(saveReport({ dir, report, name: 'haircut', now }), /уже существует/);
  const json = await saveReport({ dir, report, format: 'json', name: 'haircut', now });
  assert.deepEqual(JSON.parse(await readFile(join(dir, json.file), 'utf8')), report);
  assert.deepEqual((await readdir(dir)).sort(), ['haircut.json', 'haircut.md']);
});
test('tampered report is not saved', async t => {
  const dir = await directory(t);
  await assert.rejects(saveReport({ dir, report: { ...report, text: 'подмена' } }), /повреждены/);
  assert.deepEqual(await readdir(dir), []);
});
