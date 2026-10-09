import test from 'node:test';
import assert from 'node:assert/strict';
import { BENCHMARK_TASKS, createOptimizationRunner, PROFILES, publicProfile } from './OptimizationCore.js';

function fakeClient({ failModel, noResources = false } = {}) {
  const calls = [];
  return {
    calls,
    async warmup(profile) { calls.push(['warmup', profile.id]); if (profile.model === failModel) throw new Error('model missing'); },
    async generate(request) { calls.push(['generate', request]); return { content: `Ответ ${request.model}`, metrics: { wallMs: 100, outputTokens: 20, tokensPerSecond: 25 } }; },
    async running(model) { calls.push(['running', model]); return noResources ? null : { residentBytes: 1000, vramBytes: 500 }; },
    async unload(model) { calls.push(['unload', model]); },
  };
}

test('profiles expose optimization parameters without system prompts', () => {
  const baseline = publicProfile(PROFILES.baseline); const optimized = publicProfile(PROFILES.optimized);
  assert.equal(baseline.options.temperature, 0.7); assert.equal(optimized.options.temperature, 0.15);
  assert.equal(optimized.quantization, 'Q4_K_M'); assert.equal('systemPrompt' in optimized, false);
});

test('compare warms, measures and unloads profiles sequentially', async () => {
  const client = fakeClient(); const result = await createOptimizationRunner({ client }).compare('Как исправить код?');
  assert.equal(result.baseline.status, 'success'); assert.equal(result.optimized.resources.vramBytes, 500);
  assert.deepEqual(client.calls.filter(call => call[0] !== 'generate').map(call => call[0]), ['warmup', 'running', 'unload', 'warmup', 'running', 'unload']);
  const generations = client.calls.filter(call => call[0] === 'generate').map(call => call[1]);
  assert.equal(generations[0].messages[1].content, generations[1].messages[1].content);
  assert.match(generations[1].messages[0].content, /Kotlin\/Android/); assert.equal(generations[1].options.num_ctx, 2048);
});

test('benchmark warms once per profile and preserves partial failures', async () => {
  const client = fakeClient({ failModel: PROFILES.baseline.model });
  const result = await createOptimizationRunner({ client }).benchmark(BENCHMARK_TASKS.slice(0, 2));
  assert.equal(result.length, 2); assert.equal(result[0].baseline.status, 'error'); assert.equal(result[1].optimized.status, 'success');
  assert.equal(client.calls.filter(call => call[0] === 'warmup').length, 2); assert.equal(client.calls.filter(call => call[0] === 'generate').length, 2);
});

test('missing resource metrics do not fail generation', async () => {
  const result = await createOptimizationRunner({ client: fakeClient({ noResources: true }) }).compare('test');
  assert.equal(result.optimized.status, 'success'); assert.equal(result.optimized.resources, null);
});
