import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp } from './index.js';

const embedder = { model: 'api-test', async embed(texts) { return texts.map(text => [text.length, 1]); } };
const generator = { async generate({ format, input }) {
  if (!format) return 'семантический поиск';
  const quote = input.match(/<source>\n([^\n]+)/)?.[1];
  return JSON.stringify({ answer: 'Подтверждённый ответ [S1]', citations: [{ sourceLabel: 'S1', quote }] });
} };

async function listeningServer(t, app) {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return server;
}

async function fixture(t, customGenerator = generator) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'day24-api-'));
  await fs.writeFile(path.join(root, 'doc.md'), '# API\nЛокальный индекс документов и семантический поиск.');
  const manifestPath = path.join(root, 'manifest.json');
  const questionsPath = path.join(root, 'evaluation.json');
  await fs.writeFile(manifestPath, JSON.stringify({ entries: [{ path: 'doc.md', source: 'api-handbook' }] }));
  await fs.writeFile(questionsPath, JSON.stringify([{ id: 1, question: 'Вопрос?', expectation: 'Ответ', sources: ['doc.md'] }]));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return listeningServer(t, createApp({ embedder, generator: customGenerator, indexesDir: path.join(root, 'indexes'), manifestPath, questionsPath }));
}

test('API builds index, returns grounded answer, and exposes evaluation questions', async t => {
  const app = await fixture(t);
  let response = await request(app).get('/api/index').expect(200);
  assert.equal(response.body.index.available, false);
  assert.deepEqual(response.body.ragDefaults, { candidateTopK: 8, resultTopK: 3, similarityThreshold: 0.35 });
  await request(app).post('/api/index/build').send({}).expect(200);
  response = await request(app).post('/api/answer').send({ question: 'Что такое поиск?', settings: { similarityThreshold: -1 } }).expect(200);
  assert.equal(response.body.contextFound, true);
  assert.match(response.body.answer, /\[S1\]/);
  assert.equal(response.body.sources[0].source, 'api-handbook');
  assert.equal(response.body.quotes.length, 1);
  assert.equal(response.body.retrieval.rewrittenQuery, 'семантический поиск');
  const sourceFile = response.body.sources[0].file;
  response = await request(app).get('/api/evaluation/questions').expect(200);
  assert.equal(response.body.questions.length, 1);
  response = await request(app).get('/api/documents/file').query({ path: sourceFile }).expect(200);
  assert.match(response.text, /Локальный индекс/);
});

test('API returns explicit do-not-know contract for weak context', async t => {
  const app = await fixture(t);
  await request(app).post('/api/index/build').send({}).expect(200);
  const response = await request(app).post('/api/answer').send({ question: 'Вопрос', settings: { similarityThreshold: 1 } }).expect(200);
  assert.equal(response.body.contextFound, false);
  assert.match(response.body.answer, /Я не знаю/);
  assert.deepEqual(response.body.sources, []);
  assert.deepEqual(response.body.quotes, []);
});

test('API validates input and protects files outside the corpus', async t => {
  const app = await fixture(t);
  await request(app).post('/api/answer').send({ question: '' }).expect(400);
  await request(app).post('/api/answer').send({ question: 'test', settings: { candidateTopK: 2, resultTopK: 3 } }).expect(400);
  await request(app).post('/api/answer').send({ question: 'test', settings: { similarityThreshold: -2 } }).expect(400);
  await request(app).post('/api/compare').send({ question: 'test' }).expect(404);
  await request(app).get('/api/documents/file').query({ path: '../.env' }).expect(404);
});

test('API exposes a controlled error after invalid answer and repair', async t => {
  const app = await fixture(t, { async generate({ format }) { return format ? '{invalid' : 'rewrite'; } });
  await request(app).post('/api/index/build').send({}).expect(200);
  const response = await request(app).post('/api/answer').send({ question: 'Вопрос', settings: { similarityThreshold: -1 } }).expect(502);
  assert.match(response.body.error, /Не удалось получить подтверждённый ответ/);
});

test('API rejects concurrent indexing', async t => {
  let release; let started;
  const gate = new Promise(resolve => { release = resolve; });
  const called = new Promise(resolve => { started = resolve; });
  const slow = { model: 'slow', async embed(texts) { started(); await gate; return texts.map(() => [1, 1]); } };
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'day24-concurrent-'));
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
