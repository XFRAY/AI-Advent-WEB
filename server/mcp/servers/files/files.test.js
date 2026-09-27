import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { listReports, readReport, safeName, saveReport } from './files.js';
const now = new Date('2026-09-26T10:00:00Z');
async function directory(t) { const dir = await mkdtemp(join(tmpdir(), 'reports-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }
test('names cannot escape the reports directory', () => {
  assert.equal(safeName('../../etc/passwd'), 'etc-passwd');
  assert.equal(safeName('Отчёт Май.md'), 'отчёт-май-md');
  assert.equal(safeName('..', now), 'report-20260926100000');
});
test('saves markdown privately, never overwrites, lists and reads reports', async t => {
  const dir = await directory(t);
  assert.deepEqual(await listReports({ dir: join(dir, 'missing') }), { reports: [], total: 0 });
  const saved = await saveReport({ dir, title: 'Цены\nна стрижки', markdown: '| A | 1 |', name: 'haircut', now });
  assert.equal(saved.file, 'haircut.md');
  const content = await readFile(join(dir, 'haircut.md'), 'utf8');
  assert.equal(content, '# Цены на стрижки\n\n| A | 1 |\n'); assert.equal(Buffer.byteLength(content), saved.bytes);
  assert.equal((await stat(join(dir, 'haircut.md'))).mode & 0o777, 0o600);
  await assert.rejects(saveReport({ dir, title: 'x', markdown: 'y', name: 'haircut', now }), /уже существует/);
  await writeFile(join(dir, 'notes.txt'), 'ignored');
  const list = await listReports({ dir });
  assert.deepEqual(list.reports.map(item => item.file), ['haircut.md']); assert.equal(list.total, 1);
  assert.deepEqual(await readReport({ dir, file: 'haircut.md' }), { file: 'haircut.md', content, truncated: false });
  await assert.rejects(readReport({ dir, file: '../package.json' }), /Некорректное имя/);
  await assert.rejects(readReport({ dir, file: 'missing.md' }), /не найден/);
  assert.deepEqual((await readdir(dir)).sort(), ['haircut.md', 'notes.txt']);
});
