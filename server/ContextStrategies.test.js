import assert from 'node:assert/strict';
import test from 'node:test';
import { ContextStrategies, buildTokenComparison } from './ContextStrategies.js';

const history = [
  { role: 'user', text: 'Message 1' },
  { role: 'agent', text: 'Message 2' },
  { role: 'user', text: 'Message 3' },
  { role: 'agent', text: 'Message 4' },
  { role: 'user', text: 'Message 5' },
];

test('Sliding Window sends exactly the latest N messages', () => {
  const strategies = new ContextStrategies({ model: 'gpt-5-nano' });
  const prepared = strategies.previewSliding({
    history,
    settings: {
      lastMessagesCount: 2,
    },
  });

  assert.deepEqual(prepared.conversationHistoryInput, [
    { role: 'assistant', content: 'Message 4' },
    { role: 'user', content: 'Message 5' },
  ]);
  assert.equal(prepared.stats.sentMessageCount, 2);
  assert.equal(prepared.stats.droppedMessageCount, 3);
});

test('Sticky Facts sends facts plus the latest N messages', () => {
  const strategies = new ContextStrategies({ model: 'gpt-5-nano' });
  const prepared = strategies.previewFacts({
    history,
    facts: {
      goal: 'Build onboarding assistant',
      constraints: 'No extra SaaS budget',
      preferences: '',
      decisions: '',
      openQuestions: '',
      agreements: '',
    },
    settings: {
      lastMessagesCount: 2,
    },
  });

  assert.equal(prepared.conversationHistoryInput[0].role, 'system');
  assert.match(prepared.conversationHistoryInput[0].content, /Build onboarding assistant/);
  assert.deepEqual(prepared.conversationHistoryInput.slice(1), [
    { role: 'assistant', content: 'Message 4' },
    { role: 'user', content: 'Message 5' },
  ]);
  assert.equal(prepared.stats.sentMessageCount, 2);
  assert.ok(prepared.stats.factsCharacters > 0);
});

test('Sticky Facts updates facts from model JSON', async () => {
  const strategies = new ContextStrategies({
    model: 'gpt-5-nano',
    client: {
      responses: {
        create: async () => ({
          output_text: JSON.stringify({
            goal: 'Updated goal',
            constraints: 'Keep budget zero',
            preferences: 'Short answers',
            decisions: 'Ship MVP',
            openQuestions: 'Admin role',
            agreements: 'Russian language',
          }),
        }),
      },
    },
  });

  const facts = await strategies.updateFacts({
    facts: {},
    userMessage: 'Remember this',
  });

  assert.equal(facts.goal, 'Updated goal');
  assert.equal(facts.constraints, 'Keep budget zero');
  assert.equal(facts.preferences, 'Short answers');
});

test('Branching sends the active branch history without trimming', () => {
  const strategies = new ContextStrategies({ model: 'gpt-5-nano' });
  const prepared = strategies.previewBranching({
    history,
    settings: {
      lastMessagesCount: 2,
    },
  });

  assert.equal(prepared.conversationHistoryInput.length, history.length);
  assert.equal(prepared.stats.sentMessageCount, history.length);
  assert.equal(prepared.stats.droppedMessageCount, 0);
});

test('buildTokenComparison returns per-strategy token usage', () => {
  const comparison = buildTokenComparison({
    sliding: {
      fullInputTokens: 100,
      conversationHistoryTokens: 80,
      currentRequestTokens: 20,
      context: { status: 'ok' },
    },
    facts: {
      fullInputTokens: 150,
      conversationHistoryTokens: 130,
      currentRequestTokens: 20,
      context: { status: 'ok' },
    },
  });

  assert.equal(comparison.sliding.fullInputTokens, 100);
  assert.equal(comparison.facts.conversationHistoryTokens, 130);
  assert.equal(comparison.branching, undefined);
});
