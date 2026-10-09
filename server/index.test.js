import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import request from 'supertest';
import { createApp, MAX_PROMPT_LENGTH } from './index.js';
import { PROFILES } from './OptimizationCore.js';

async function listeningServer(t, app) {
  const server = http.createServer(app); await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  t.after(() => new Promise(resolve => server.close(resolve))); return server;
}

const success = profile => ({ status: 'success', profile, model: profile, answer: 'answer', metrics: { wallMs: 10 }, resources: null });
function fixtures() {
  const ollamaClient = { async status(models) { return { version: '1.0', models: Object.fromEntries(models.map(model => [model, { installed: true, sizeBytes: 100 }])) }; } };
  const runner = { profiles: PROFILES, async compare() { return { baseline: success('baseline'), optimized: success('optimized') }; }, async benchmark(tasks) { return tasks.map(task => ({ ...task, baseline: success('baseline'), optimized: success('optimized') })); } };
  return { ollamaClient, runner };
}

test('status reports both profiles and their parameters', async t => {
  const server = await listeningServer(t, createApp(fixtures())); const result = await request(server).get('/api/optimization/status').expect(200);
  assert.equal(result.body.ollama.available, true); assert.equal(result.body.profiles.baseline.installed, true); assert.equal(result.body.profiles.optimized.options.num_predict, 320);
});

test('status remains useful while Ollama is unavailable', async t => {
  const values = fixtures(); values.ollamaClient.status = async () => { throw new Error('offline'); };
  const result = await request(await listeningServer(t, createApp(values))).get('/api/optimization/status').expect(200);
  assert.equal(result.body.ollama.available, false); assert.equal(result.body.profiles.baseline.installed, false);
});

test('compare validates and trims prompts', async t => {
  const values = fixtures(); let received; values.runner.compare = async prompt => { received = prompt; return { baseline: success('baseline'), optimized: success('optimized') }; };
  const server = await listeningServer(t, createApp(values));
  await request(server).post('/api/optimization/compare').send({ prompt: '  Kotlin?  ' }).expect(200); assert.equal(received, 'Kotlin?');
  await request(server).post('/api/optimization/compare').send({ prompt: ' ' }).expect(400);
  await request(server).post('/api/optimization/compare').send({ prompt: 'x'.repeat(MAX_PROMPT_LENGTH + 1) }).expect(400);
});

test('benchmark returns the fixed task suite', async t => {
  const result = await request(await listeningServer(t, createApp(fixtures()))).post('/api/optimization/benchmark').send({}).expect(200);
  assert.equal(result.body.tasks.length, 4); assert.equal(result.body.tasks[3].category, 'Jetpack Compose');
});

test('compare exposes partial model failure without failing request', async t => {
  const values = fixtures(); values.runner.compare = async () => ({ baseline: { status: 'error', error: 'missing' }, optimized: success('optimized') });
  const result = await request(await listeningServer(t, createApp(values))).post('/api/optimization/compare').send({ prompt: 'test' }).expect(200);
  assert.equal(result.body.baseline.status, 'error'); assert.equal(result.body.optimized.status, 'success');
});
