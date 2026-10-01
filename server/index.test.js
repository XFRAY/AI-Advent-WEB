import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp } from './index.js';

const embedder = { model: 'api-test', async embed(texts) { return texts.map(text => [text.length, 1]); } };
const generator = { async generate({ input }) { return input.includes('Контекст базы знаний') ? 'Ответ с источником [S1]' : 'Ответ без источника'; } };

async function listeningServer(t, app) {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return server;
}

async function fixture(t, customGenerator = generator) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'day22-api-'));
  await fs.writeFile(path.join(root, 'doc.md'), '# API\nЛокальный индекс документов и семантический поиск.');
  const manifestPath = path.join(root, 'manifest.json');
  const questionsPath = path.join(root, 'evaluation.json');
  await fs.writeFile(manifestPath, JSON.stringify({ entries: [{ path: 'doc.md', source: 'api-test' }] }));
  await fs.writeFile(questionsPath, JSON.stringify([{ id: 1, question: 'Вопрос?', expectation: 'Ответ', sources: ['doc.md'] }]));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return listeningServer(t, createApp({ embedder, generator: customGenerator, indexesDir: path.join(root, 'indexes'), manifestPath, questionsPath }));
}

test('API builds index, compares modes, and exposes evaluation questions', async t => {
  const app = await fixture(t);
  let response = await request(app).get('/api/index').expect(200);
  assert.equal(response.body.index.available, false);
  await request(app).post('/api/index/build').send({}).expect(200);
  response = await request(app).post('/api/compare').send({ question: 'Что такое поиск?' }).expect(200);
  assert.equal(response.body.withoutRag.status, 'success');
  assert.equal(response.body.withoutRag.sources, undefined);
  assert.equal(response.body.withRag.sources.length, 1);
  const sourceFile = response.body.withRag.sources[0].file;
  response = await request(app).get('/api/evaluation/questions').expect(200);
  assert.equal(response.body.questions.length, 1);
  response = await request(app).get('/api/documents/file').query({ path: sourceFile }).expect(200);
  assert.match(response.text, /Локальный индекс/);
});

test('API validates input and protects files outside the corpus', async t => {
  const app = await fixture(t);
  await request(app).post('/api/compare').send({ question: '' }).expect(400);
  await request(app).get('/api/documents/file').query({ path: '../.env' }).expect(404);
});

test('API returns partial success when one mode fails', async t => {
  const app = await fixture(t, { async generate({ input }) { if (!input.includes('Контекст базы знаний')) throw new Error('fail'); return 'RAG ok [S1]'; } });
  await request(app).post('/api/index/build').send({}).expect(200);
  const response = await request(app).post('/api/compare').send({ question: 'Вопрос' }).expect(200);
  assert.equal(response.body.withoutRag.status, 'error');
  assert.equal(response.body.withRag.status, 'success');
});

test('API rejects concurrent indexing', async t => {
  let release; let started;
  const gate = new Promise(resolve => { release = resolve; });
  const called = new Promise(resolve => { started = resolve; });
  const slow = { model: 'slow', async embed(texts) { started(); await gate; return texts.map(() => [1, 1]); } };
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'day22-concurrent-'));
  await fs.writeFile(path.join(root, 'doc.md'), '# Test\nContent');
  await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify({ entries: [{ path: 'doc.md', source: 'test' }] }));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const app = await listeningServer(t, createApp({ embedder: slow, generator, indexesDir: path.join(root, 'indexes'), manifestPath: path.join(root, 'manifest.json') }));
  const first = request(app).post('/api/index/build').send({}).then(response => response);
  await called;
  await request(app).post('/api/index/build').send({}).expect(409);
  release();
  assert.equal((await first).status, 200);
});
