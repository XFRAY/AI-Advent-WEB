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
  if (format?.name === 'task_state') return JSON.stringify({ goal: 'Проверить API', clarifications: [], constraints: [], terms: [] });
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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'day25-api-'));
  await fs.writeFile(path.join(root, 'doc.md'), '# API\nЛокальный индекс документов и семантический поиск.');
  const manifestPath = path.join(root, 'manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify({ entries: [{ path: 'doc.md', source: 'api-handbook' }] }));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { server: await listeningServer(t, createApp({ embedder, generator: customGenerator, indexesDir: path.join(root, 'indexes'), manifestPath, databasePath: path.join(root, 'chat.sqlite') })), sourceFile: path.relative(path.resolve('.'), path.join(root, 'doc.md')) };
}

test('API builds index and serves only corpus files', async t => {
  const { server, sourceFile } = await fixture(t);
  let response = await request(server).get('/api/index').expect(200);
  assert.equal(response.body.index.available, false);
  assert.deepEqual(response.body.ragDefaults, { candidateTopK: 8, resultTopK: 3, similarityThreshold: 0.35 });
  await request(server).post('/api/index/build').send({}).expect(200);
  response = await request(server).get('/api/index').expect(200);
  assert.equal(response.body.index.available, true);
  response = await request(server).get('/api/documents/file').query({ path: sourceFile }).expect(200);
  assert.match(response.text, /Локальный индекс/);
  await request(server).get('/api/documents/file').query({ path: '../.env' }).expect(404);
});

test('conversation API creates, lists, restores, and appends grounded turns', async t => {
  const { server } = await fixture(t);
  await request(server).post('/api/index/build').send({}).expect(200);
  let response = await request(server).post('/api/conversations').send({}).expect(201);
  const id = response.body.conversation.id;
  response = await request(server).post(`/api/conversations/${id}/messages`).send({ content: 'Что такое поиск?', settings: { similarityThreshold: -1 } }).expect(200);
  assert.equal(response.body.conversation.messages.length, 2);
  assert.equal(response.body.message.contextFound, true);
  assert.equal(response.body.message.sources[0].source, 'api-handbook');
  assert.equal(response.body.conversation.taskState.goal, 'Проверить API');
  response = await request(server).get(`/api/conversations/${id}`).expect(200);
  assert.equal(response.body.conversation.messages[1].quotes.length, 1);
  response = await request(server).get('/api/conversations').expect(200);
  assert.equal(response.body.conversations[0].messageCount, 2);
  await request(server).get('/api/conversations/missing').expect(404);
});

test('conversation API clears every saved chat', async t => {
  const { server } = await fixture(t);
  await request(server).post('/api/conversations').send({}).expect(201);
  await request(server).post('/api/conversations').send({}).expect(201);
  const response = await request(server).delete('/api/conversations').expect(200);
  assert.equal(response.body.deleted, 2);
  const list = await request(server).get('/api/conversations').expect(200);
  assert.deepEqual(list.body.conversations, []);
});

test('chat persists explicit do-not-know response without sources', async t => {
  const { server } = await fixture(t);
  await request(server).post('/api/index/build').send({}).expect(200);
  const created = await request(server).post('/api/conversations').send({}).expect(201);
  const response = await request(server).post(`/api/conversations/${created.body.conversation.id}/messages`).send({ content: 'Вопрос', settings: { similarityThreshold: 1 } }).expect(200);
  assert.equal(response.body.message.contextFound, false);
  assert.match(response.body.message.content, /Я не знаю/);
  assert.deepEqual(response.body.message.sources, []);
});

test('API validates chat input and rejects unknown routes', async t => {
  const { server } = await fixture(t);
  const created = await request(server).post('/api/conversations').send({}).expect(201);
  const endpoint = `/api/conversations/${created.body.conversation.id}/messages`;
  await request(server).post(endpoint).send({ content: '' }).expect(400);
  await request(server).post(endpoint).send({ content: 'test', settings: { candidateTopK: 2, resultTopK: 3 } }).expect(400);
  await request(server).post(endpoint).send({ content: 'test', settings: { similarityThreshold: -2 } }).expect(400);
  await request(server).post('/api/unknown').send({}).expect(404);
});

test('API exposes a controlled error after invalid answer and repair', async t => {
  const invalid = { async generate({ format }) { return format?.name === 'task_state' ? JSON.stringify({ goal: null, clarifications: [], constraints: [], terms: [] }) : format ? '{invalid' : 'rewrite'; } };
  const { server } = await fixture(t, invalid);
  await request(server).post('/api/index/build').send({}).expect(200);
  const created = await request(server).post('/api/conversations').send({}).expect(201);
  const response = await request(server).post(`/api/conversations/${created.body.conversation.id}/messages`).send({ content: 'Вопрос', settings: { similarityThreshold: -1 } }).expect(502);
  assert.match(response.body.error, /Не удалось получить подтверждённый ответ/);
});

test('API rejects concurrent indexing', async t => {
  let release; let started;
  const gate = new Promise(resolve => { release = resolve; });
  const called = new Promise(resolve => { started = resolve; });
  const slow = { model: 'slow', async embed(texts) { started(); await gate; return texts.map(() => [1, 1]); } };
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'day25-concurrent-'));
  await fs.writeFile(path.join(root, 'doc.md'), '# Test\nContent');
  await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify({ entries: [{ path: 'doc.md', source: 'test' }] }));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const server = await listeningServer(t, createApp({ embedder: slow, generator, indexesDir: path.join(root, 'indexes'), manifestPath: path.join(root, 'manifest.json'), databasePath: path.join(root, 'chat.sqlite') }));
  const first = request(server).post('/api/index/build').send({}).then(response => response);
  await called;
  await request(server).post('/api/index/build').send({}).expect(409);
  release();
  assert.equal((await first).status, 200);
});
