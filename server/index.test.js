import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp } from './index.js';

const embedder = { model: 'api-test', async embed(texts) { return texts.map(text => [text.length, 1]); } };

async function fixture(t, customEmbedder = embedder) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'day21-api-'));
  await fs.writeFile(path.join(root, 'doc.md'), '# API\nЛокальный индекс документов и семантический поиск.');
  const manifestPath = path.join(root, 'manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify({ entries: [{ path: 'doc.md', source: 'api-test' }] }));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return createApp({ embedder: customEmbedder, indexesDir: path.join(root, 'indexes'), manifestPath });
}

test('API builds both indexes, exposes chunks, and searches', async t => {
  const app = await fixture(t);
  let response = await request(app).get('/api/indexes').expect(200);
  assert.equal(response.body.indexes.every(item => !item.available), true);
  response = await request(app).post('/api/indexes/build').send({ strategy: 'all' }).expect(200);
  assert.equal(response.body.indexes.length, 2);
  response = await request(app).get('/api/indexes/fixed/chunks?limit=1').expect(200);
  assert.equal(response.body.chunks.length, 1);
  assert.equal('embedding' in response.body.chunks[0], false);
  response = await request(app).post('/api/search').send({ query: 'индекс', strategy: 'all', topK: 1 }).expect(200);
  assert.equal(response.body.results.fixed.length, 1);
  response = await request(app).get('/api/documents/file').query({ path: response.body.results.fixed[0].metadata.file }).expect(200);
  assert.match(response.text, /Локальный индекс/);
  response = await request(app).delete('/api/indexes').expect(200);
  assert.deepEqual(response.body.removed.sort(), ['fixed', 'structured']);
  response = await request(app).get('/api/indexes').expect(200);
  assert.equal(response.body.indexes.every(item => !item.available), true);
});

test('API validates build, search, and pagination inputs', async t => {
  const app = await fixture(t);
  await request(app).post('/api/indexes/build').send({ strategy: 'wrong' }).expect(400);
  await request(app).post('/api/search').send({ query: '', topK: 5 }).expect(400);
  await request(app).get('/api/indexes/fixed/chunks?limit=1001').expect(400);
  await request(app).get('/api/documents/file').query({ path: '../.env' }).expect(404);
});

test('API rejects concurrent indexing', async t => {
  let release; let started;
  const gate = new Promise(resolve => { release = resolve; });
  const called = new Promise(resolve => { started = resolve; });
  const slow = { model: 'slow', async embed(texts) { started(); await gate; return texts.map(() => [1, 1]); } };
  const app = await fixture(t, slow);
  const firstPromise = request(app).post('/api/indexes/build').send({ strategy: 'fixed' }).then(response => response);
  await called;
  await request(app).post('/api/indexes/build').send({ strategy: 'fixed' }).expect(409);
  release();
  assert.equal((await firstPromise).status, 200);
});
