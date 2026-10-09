import test from 'node:test';
import assert from 'node:assert/strict';
import { createOllamaClient } from './ollama.js';

function response(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }); }

test('Ollama client reports model details and computes generation metrics', async () => {
  const bodies = [];
  const fetchImpl = async (url, options = {}) => {
    if (url.endsWith('/api/version')) return response({ version: '0.12.6' });
    if (url.endsWith('/api/tags')) return response({ models: [{ name: 'qwen3:1.7b-q4_K_M', size: 1_400_000_000, details: { quantization_level: 'Q4_K_M' } }] });
    if (url.endsWith('/api/ps')) return response({ models: [{ name: 'qwen3:1.7b-q4_K_M', size: 2_000_000_000, size_vram: 1_500_000_000 }] });
    bodies.push(JSON.parse(options.body)); return response({ message: { content: 'Готово' }, total_duration: 3e9, load_duration: 1e8, prompt_eval_duration: 4e8, eval_duration: 2e9, prompt_eval_count: 40, eval_count: 50 });
  };
  const client = createOllamaClient({ fetchImpl }); const status = await client.status(['qwen3:1.7b-q4_K_M', 'missing']);
  assert.equal(status.models['qwen3:1.7b-q4_K_M'].sizeBytes, 1_400_000_000); assert.equal(status.models.missing.installed, false);
  const result = await client.generate({ model: 'qwen3:1.7b-q4_K_M', messages: [], options: { temperature: .15 } });
  assert.equal(result.metrics.generationMs, 2000); assert.equal(result.metrics.tokensPerSecond, 25); assert.equal(result.metrics.outputTokens, 50);
  assert.equal(bodies[0].think, false); assert.equal(bodies[0].options.temperature, .15);
  assert.equal((await client.running('qwen3:1.7b-q4_K_M')).vramBytes, 1_500_000_000);
});

test('Ollama client sends warmup and unload requests', async () => {
  const calls = [];
  const client = createOllamaClient({ fetchImpl: async (url, options = {}) => { calls.push([url, options.body && JSON.parse(options.body)]); return response(url.endsWith('/api/chat') ? { message: { content: 'OK' } } : {}); } });
  await client.warmup({ model: 'qwen', options: { num_predict: 99 } }); await client.unload('qwen');
  assert.equal(calls[0][1].options.num_predict, 2); assert.equal(calls[1][1].keep_alive, 0);
});

test('Ollama client maps network, timeout and empty response failures', async () => {
  const unavailable = createOllamaClient({ fetchImpl: async () => { throw new Error('offline'); } });
  await assert.rejects(unavailable.status([]), error => error.code === 'OLLAMA_UNAVAILABLE');
  const timedOut = createOllamaClient({ fetchImpl: async () => { const error = new Error('timeout'); error.name = 'TimeoutError'; throw error; } });
  await assert.rejects(timedOut.generate({ model: 'x', messages: [] }), error => error.code === 'OLLAMA_TIMEOUT');
  const empty = createOllamaClient({ fetchImpl: async () => response({ message: { content: '' } }) });
  await assert.rejects(empty.generate({ model: 'x', messages: [] }), /пустой ответ/);
});
