import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRagPrompt, createLocalGenerator, publicSources, safeGenerate, validateGroundedAnswer } from './RagCore.js';

const results = [{ score: .91, text: 'Wi-Fi работает каждый день.', metadata: { source: 'cafe', file: 'cafe.md', section: 'Услуги', chunk_id: 'abc' } }];

test('grounding validates exact quotes and known source labels', () => {
  const sources = publicSources(results); const value = { answer: 'Wi-Fi доступен [S1]', citations: [{ sourceLabel: 'S1', quote: 'Wi-Fi работает каждый день.' }] };
  assert.equal(validateGroundedAnswer(value, sources).groundingPassed, true); assert.match(buildRagPrompt('Wi-Fi?', sources), /\[S1\]/);
  assert.equal(validateGroundedAnswer(`\`\`\`json\n${JSON.stringify(value)}\n\`\`\``, sources).groundingPassed, true);
  assert.throws(() => validateGroundedAnswer({ ...value, citations: [{ sourceLabel: 'S1', quote: 'нет такой цитаты' }] }, sources), /не подтверждена/);
  assert.throws(() => validateGroundedAnswer({ ...value, answer: 'Ответ [S2]' }, sources), /неизвестный источник/);
});

test('safe generation exposes stability without throwing', async () => {
  assert.equal((await safeGenerate({ configured: false, model: 'cloud' }, 'q', [])).status, 'unavailable');
  const result = await safeGenerate({ configured: true, model: 'x', async generate() { throw new Error('boom'); } }, 'q', []);
  assert.deepEqual(result, { status: 'error', model: 'x', groundingPassed: false, error: 'boom' });
});

test('local generator repairs one malformed structured answer', async () => {
  let calls = 0;
  const client = { async generate() { calls += 1; return { content: calls === 1 ? 'not json' : JSON.stringify({ answer: 'Wi-Fi доступен [S1]', citations: [{ sourceLabel: 'S1', quote: 'Wi-Fi работает каждый день.' }] }), model: 'qwen', durationMs: 5 }; } };
  const result = await createLocalGenerator({ client, model: 'qwen' }).generate('Wi-Fi?', publicSources(results));
  assert.equal(calls, 2); assert.equal(result.groundingPassed, true); assert.equal(result.durationMs, 10);
});
