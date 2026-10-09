import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import request from 'supertest';
import { createApp } from './index.js';
import { buildIndex } from './indexing/pipeline.js';

async function listeningServer(t, app) {
  const server = http.createServer(app); await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  t.after(() => new Promise(resolve => server.close(resolve))); return server;
}

async function fixture(t, model = 'embeddinggemma') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'day28-api-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'cafe.md'), '# Кафе Тест\nWi-Fi работает каждый день. Есть веганский завтрак.');
  const manifestPath = path.join(root, 'manifest.json'); await fs.writeFile(manifestPath, JSON.stringify({ entries: [{ path: 'cafe.md', source: 'test-cafe' }] }));
  const indexesDir = path.join(root, 'indexes');
  const embedder = { model, async embed(texts) { return texts.map(text => [/wi-fi/iu.test(text) ? 1 : .1, /веган/iu.test(text) ? 1 : .1]); } };
  return { manifestPath, indexesDir, embedder };
}

const ollamaClient = { async status(models) { return { available: true, version: '1.0', models: Object.fromEntries(models.map(model => [model, true])) }; } };
const grounded = { configured: true, model: 'model', async generate(_question, sources) { return { answer: `Wi-Fi доступен [S1]`, citations: [{ sourceLabel: 'S1', quote: 'Wi-Fi работает каждый день.' }], sources: [{ ...sources[0], text: undefined }], groundingPassed: true, model: this.model, durationMs: 10 }; } };

test('status reports local models, cloud and compatible index', async t => {
  const paths = await fixture(t); await buildIndex(paths);
  const server = await listeningServer(t, createApp({ ...paths, ollamaClient, localGenerator: grounded, cloudGenerator: { ...grounded, configured: false } }));
  const result = await request(server).get('/api/rag/status').expect(200);
  assert.equal(result.body.local.ready, true); assert.equal(result.body.embedding.ready, true); assert.equal(result.body.index.compatible, true); assert.equal(result.body.cloud.configured, false);
});

test('compare uses one local retrieval for both generators and tolerates missing cloud', async t => {
  const paths = await fixture(t); await buildIndex(paths); let received;
  const localGenerator = { ...grounded, async generate(question, sources) { received = { question, sources }; return grounded.generate(question, sources); } };
  const server = await listeningServer(t, createApp({ ...paths, ollamaClient, localGenerator, cloudGenerator: { model: 'cloud', configured: false } }));
  const result = await request(server).post('/api/rag/compare').send({ question: 'Где есть Wi-Fi?' }).expect(200);
  assert.equal(result.body.local.status, 'success'); assert.equal(result.body.cloud.status, 'unavailable'); assert.equal(received.sources[0].label, 'S1'); assert.deepEqual(result.body.retrieval.sources, received.sources.map(({ text: _text, ...source }) => source));
});

test('compare returns independent cloud error and validates questions', async t => {
  const paths = await fixture(t); await buildIndex(paths);
  const brokenCloud = { configured: true, model: 'cloud', async generate() { throw new Error('cloud offline'); } };
  const server = await listeningServer(t, createApp({ ...paths, ollamaClient, localGenerator: grounded, cloudGenerator: brokenCloud }));
  let result = await request(server).post('/api/rag/compare').send({ question: 'Wi-Fi?' }).expect(200);
  assert.equal(result.body.local.status, 'success'); assert.equal(result.body.cloud.status, 'error'); assert.match(result.body.cloud.error, /offline/);
  await request(server).post('/api/rag/compare').send({ question: ' ' }).expect(400);
});

test('missing and incompatible indexes request a rebuild', async t => {
  const paths = await fixture(t);
  let server = await listeningServer(t, createApp({ ...paths, ollamaClient, localGenerator: grounded, cloudGenerator: { model: 'cloud', configured: false } }));
  await request(server).post('/api/rag/compare').send({ question: 'Wi-Fi?' }).expect(409);
  await buildIndex({ ...paths, embedder: { ...paths.embedder, model: 'text-embedding-3-small' } });
  const status = await request(server).get('/api/rag/status').expect(200); assert.equal(status.body.index.compatible, false);
  await request(server).post('/api/rag/compare').send({ question: 'Wi-Fi?' }).expect(409);
});

test('index endpoint builds with local embedder', async t => {
  const paths = await fixture(t); const server = await listeningServer(t, createApp({ ...paths, ollamaClient, localGenerator: grounded, cloudGenerator: { model: 'cloud', configured: false } }));
  const result = await request(server).post('/api/rag/index').send({}).expect(200); assert.equal(result.body.index.embedding.model, 'embeddinggemma');
  await fs.access(path.join(paths.indexesDir, 'structured.json'));
});

test('index endpoint rejects concurrent builds', async t => {
  const paths = await fixture(t); let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const slowEmbedder = { model: paths.embedder.model, async embed(texts) { await waiting; return paths.embedder.embed(texts); } };
  const server = await listeningServer(t, createApp({ ...paths, embedder: slowEmbedder, ollamaClient, localGenerator: grounded, cloudGenerator: { model: 'cloud', configured: false } }));
  const first = request(server).post('/api/rag/index').send({});
  const pending = first.then(result => result);
  await new Promise(resolve => setImmediate(resolve));
  await request(server).post('/api/rag/index').send({}).expect(409);
  release();
  await pending;
});
