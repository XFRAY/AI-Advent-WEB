import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import request from 'supertest';
import { createApp, createOllamaClient } from './index.js';

async function listeningServer(t, app) {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return server;
}

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function fetchDouble({ models = [{ name: 'qwen3:1.7b' }], chat = { model: 'qwen3:1.7b', message: { content: 'Локальный ответ' }, total_duration: 10, eval_count: 4 } } = {}) {
  return async (url, options = {}) => {
    if (url.endsWith('/api/version')) return response({ version: '0.12.6' });
    if (url.endsWith('/api/tags')) return response({ models });
    if (url.endsWith('/api/chat')) {
      const body = JSON.parse(options.body);
      assert.equal(body.model, 'qwen3:1.7b');
      assert.equal(body.stream, false);
      assert.equal(body.think, false);
      return response(chat);
    }
    return response({ error: 'missing' }, 404);
  };
}

test('status reports Ollama version and installed model', async t => {
  const server = await listeningServer(t, createApp({ ollamaClient: createOllamaClient({ fetchImpl: fetchDouble() }) }));
  const result = await request(server).get('/api/llm/status').expect(200);
  assert.deepEqual(result.body, { available: true, version: '0.12.6', model: 'qwen3:1.7b', modelReady: true });
});

test('chat returns a local answer and generation metadata', async t => {
  const server = await listeningServer(t, createApp({ ollamaClient: createOllamaClient({ fetchImpl: fetchDouble() }) }));
  const result = await request(server).post('/api/llm/chat').send({ message: 'Привет!' }).expect(200);
  assert.equal(result.body.content, 'Локальный ответ');
  assert.equal(result.body.local, true);
  assert.equal(result.body.model, 'qwen3:1.7b');
  assert.equal(result.body.evalCount, 4);
  assert.equal(typeof result.body.durationMs, 'number');
});

test('chat validates empty and oversized messages', async t => {
  const server = await listeningServer(t, createApp({ ollamaClient: createOllamaClient({ fetchImpl: fetchDouble() }) }));
  await request(server).post('/api/llm/chat').send({ message: '  ' }).expect(400);
  await request(server).post('/api/llm/chat').send({ message: 'x'.repeat(4_001) }).expect(400);
});

test('missing model returns an actionable 503', async t => {
  const server = await listeningServer(t, createApp({ ollamaClient: createOllamaClient({ fetchImpl: fetchDouble({ models: [{ name: 'other:latest' }] }) }) }));
  const result = await request(server).post('/api/llm/chat').send({ message: 'Привет' }).expect(503);
  assert.match(result.body.error, /ollama pull qwen3:1.7b/);
});

test('unavailable Ollama returns 503 for status and chat', async t => {
  const client = createOllamaClient({ fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  const server = await listeningServer(t, createApp({ ollamaClient: client }));
  let result = await request(server).get('/api/llm/status').expect(503);
  assert.equal(result.body.available, false);
  result = await request(server).post('/api/llm/chat').send({ message: 'Привет' }).expect(503);
  assert.match(result.body.error, /ollama serve/);
});

test('upstream Ollama failure and unknown API route are controlled', async t => {
  const fetchImpl = async url => url.endsWith('/api/version') ? response({ version: '1' }) : url.endsWith('/api/tags') ? response({ models: [{ name: 'qwen3:1.7b' }] }) : response({ error: 'generation failed' }, 500);
  const server = await listeningServer(t, createApp({ ollamaClient: createOllamaClient({ fetchImpl }) }));
  const result = await request(server).post('/api/llm/chat').send({ message: 'Привет' }).expect(502);
  assert.equal(result.body.error, 'generation failed');
  await request(server).get('/api/nope').expect(404);
});
