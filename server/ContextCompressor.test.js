import assert from 'node:assert/strict';
import test from 'node:test';
import { ContextCompressor, buildTokenComparison } from './ContextCompressor.js';

const history = [
  { role: 'user', text: 'Message 1' },
  { role: 'agent', text: 'Message 2' },
  { role: 'user', text: 'Message 3' },
  { role: 'agent', text: 'Message 4' },
  { role: 'user', text: 'Message 5' },
  { role: 'agent', text: 'Message 6' },
];

test('ContextCompressor keeps exactly the latest N messages as raw context', () => {
  const compressor = new ContextCompressor({ model: 'gpt-5-nano' });
  const prepared = compressor.preview({
    history,
    summary: {
      text: 'Earlier summary',
      summarizedMessageCount: 2,
      lastMessagesCount: 2,
      summaryBatchSize: 10,
    },
    settings: {
      lastMessagesCount: 2,
      summaryBatchSize: 10,
    },
  });
  const rawMessages = prepared.conversationHistoryInput.filter((item) => item.role !== 'system');

  assert.deepEqual(rawMessages, [
    { role: 'user', content: 'Message 5' },
    { role: 'assistant', content: 'Message 6' },
  ]);
  assert.equal(prepared.stats.rawRecentMessageCount, 2);
  assert.equal(prepared.stats.pendingSummaryMessageCount, 2);
});

test('ContextCompressor refreshes summary when a batch is ready', async () => {
  class TestCompressor extends ContextCompressor {
    async generateSummary({ messages }) {
      return {
        text: `Summarized ${messages.length} messages`,
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          total_tokens: 120,
        },
      };
    }
  }

  const compressor = new TestCompressor({ model: 'gpt-5-nano' });
  const prepared = await compressor.prepare({
    history,
    summary: null,
    settings: {
      lastMessagesCount: 2,
      summaryBatchSize: 4,
    },
  });

  assert.equal(prepared.summary.text, 'Summarized 4 messages');
  assert.equal(prepared.summary.summarizedMessageCount, 4);
  assert.equal(prepared.stats.summaryUpdated, true);
  assert.equal(prepared.stats.pendingSummaryMessageCount, 0);
});

test('buildTokenComparison calculates savings between full and compressed inputs', () => {
  const comparison = buildTokenComparison(
    {
      fullInputTokens: 1000,
    },
    {
      fullInputTokens: 350,
    },
  );

  assert.deepEqual(comparison, {
    fullInputTokens: 1000,
    compressedInputTokens: 350,
    inputTokenSavings: 650,
    inputTokenSavingsPercent: 65,
  });
});
