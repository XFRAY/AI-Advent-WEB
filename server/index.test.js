import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import request from 'supertest';
import { createApp } from './index.js';

const KEY = 'test-secret';
const auth = value => ({ Authorization: `Bearer ${value}` });
const baseConfig = { apiKey: KEY, model: 'qwen:test', contextTokens: 2048, maxOutputTokens: 512, rateLimit: 50, rateWindowMs: 60_000, concurrency: 1, queueSize: 4, timeoutMs: 1000 };
const successfulClient = (overrides = {}) => ({
  async status(models) { return { version: '1.0.0', models: { [models[0]]: { installed: true } } }; },
  async generate() { return { content: 'Локальный ответ', metrics: { promptTokens: 12, outputTokens: 4 } }; },
  ...overrides,
});
const body = (extra = {}) => ({ model: 'qwen:test', messages: [{ role: 'user', content: 'Привет' }], ...extra });

async function listeningServer(t, app) { const server = http.createServer(app); await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject)); t.after(() => new Promise(resolve => server.close(resolve))); return server; }

test('health is public while status and chat require a valid bearer token', async t => {
  const server = await listeningServer(t, createApp({ ollamaClient: successfulClient(), config: baseConfig }));
  await request(server).get('/api/health').expect(200, { ok: true });
  await request(server).get('/api/status').expect(401);
  await request(server).get('/api/status').set(auth('wrong')).expect(401);
  const status = await request(server).get('/api/status').set(auth(KEY)).expect(200);
  assert.equal(status.body.model, 'qwen:test'); assert.equal(status.body.limits.contextTokens, 2048); assert.equal(status.body.runtime.queued, 0);
});

test('chat completion passes full history and returns OpenAI-compatible response', async t => {
  let received;
  const client = successfulClient({ async generate(options) { received = options; return { content: 'Ответ', metrics: { promptTokens: 21, outputTokens: 7 } }; } });
  const server = await listeningServer(t, createApp({ ollamaClient: client, config: baseConfig }));
  const messages = [{ role: 'system', content: 'Ты помощник' }, { role: 'user', content: 'Один' }, { role: 'assistant', content: 'Раз' }, { role: 'user', content: 'Два' }];
  const result = await request(server).post('/v1/chat/completions').set(auth(KEY)).send(body({ messages, temperature: 0.2, max_tokens: 100 })).expect(200);
  assert.match(result.body.id, /^chatcmpl-/); assert.equal(result.body.object, 'chat.completion'); assert.equal(result.body.choices[0].message.content, 'Ответ'); assert.equal(result.body.usage.total_tokens, 28);
  assert.deepEqual(received.messages, messages); assert.equal(received.options.num_ctx, 2048); assert.equal(received.options.num_predict, 100); assert.equal(received.timeoutMs, 1000);
});

test('chat validates streaming, model, messages, max output and context', async t => {
  const server = await listeningServer(t, createApp({ ollamaClient: successfulClient(), config: { ...baseConfig, contextTokens: 128, maxOutputTokens: 32 } }));
  const post = value => request(server).post('/v1/chat/completions').set(auth(KEY)).send(value);
  assert.match((await post(body({ stream: true })).expect(400)).body.error.message, /Потоковые/);
  await post(body({ model: 'other' })).expect(400); await post(body({ messages: [] })).expect(400); await post(body({ max_tokens: 33 })).expect(400);
  assert.match((await post(body({ messages: [{ role: 'user', content: 'я'.repeat(300) }], max_tokens: 32 })).expect(400)).body.error.message, /Контекст/);
});

test('rate limiter returns OpenAI error and Retry-After', async t => {
  let clock = 1000;
  const server = await listeningServer(t, createApp({ ollamaClient: successfulClient(), config: { ...baseConfig, rateLimit: 1, rateWindowMs: 10_000 }, now: () => clock }));
  await request(server).get('/api/status').set(auth(KEY)).expect(200);
  const limited = await request(server).get('/api/status').set(auth(KEY)).expect(429);
  assert.equal(limited.headers['retry-after'], '10'); assert.equal(limited.body.error.code, 'rate_limit_exceeded');
  clock = 11_001; await request(server).get('/api/status').set(auth(KEY)).expect(200);
});

test('queue runs requests sequentially and rejects overflow', async t => {
  const releases = []; let running = 0; let peak = 0;
  const client = successfulClient({ generate() { running += 1; peak = Math.max(peak, running); return new Promise(resolve => releases.push(() => { running -= 1; resolve({ content: 'ok', metrics: {} }); })); } });
  const server = await listeningServer(t, createApp({ ollamaClient: client, config: { ...baseConfig, queueSize: 1 } }));
  const send = () => request(server).post('/v1/chat/completions').set(auth(KEY)).send(body());
  const first = send().then(response => { assert.equal(response.status, 200); return response; }); await new Promise(resolve => setTimeout(resolve, 20));
  const second = send().then(response => { assert.equal(response.status, 200); return response; }); await new Promise(resolve => setTimeout(resolve, 20));
  const third = await send().expect(429); assert.equal(third.body.error.code, 'queue_full');
  releases.shift()(); await first; await new Promise(resolve => setTimeout(resolve, 10)); releases.shift()(); await second;
  assert.equal(peak, 1);
});

test('upstream unavailable and timeout errors map to service responses and free the queue', async t => {
  let calls = 0;
  const client = successfulClient({ async generate() { calls += 1; const error = new Error(calls === 1 ? 'offline' : 'timeout'); error.code = calls === 1 ? 'OLLAMA_UNAVAILABLE' : 'OLLAMA_TIMEOUT'; throw error; } });
  const server = await listeningServer(t, createApp({ ollamaClient: client, config: baseConfig }));
  await request(server).post('/v1/chat/completions').set(auth(KEY)).send(body()).expect(503);
  const timeout = await request(server).post('/v1/chat/completions').set(auth(KEY)).send(body()).expect(502);
  assert.equal(timeout.body.error.type, 'timeout_error');
  const status = await request(server).get('/api/status').set(auth(KEY)).expect(200); assert.equal(status.body.runtime.active, 0);
});
