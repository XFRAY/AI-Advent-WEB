import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TokenUsageAnalyzer,
  buildContextStatus,
  buildCumulativeUsage,
  buildUsageStats,
  estimateCost,
} from './TokenUsageAnalyzer.js';

test('estimateCost calculates input, cached input, and output costs', () => {
  const cost = estimateCost({
    model: 'gpt-5',
    inputTokens: 1_000,
    cachedInputTokens: 100,
    outputTokens: 200,
  });

  assert.equal(cost.currency, 'USD');
  assert.equal(cost.estimatedUsd, 0.0031375);
});

test('buildContextStatus marks ok, near limit, and overflow inputs', () => {
  assert.equal(buildContextStatus({ model: 'gpt-5', inputTokens: 10_000 }).status, 'ok');
  assert.equal(buildContextStatus({ model: 'gpt-5', inputTokens: 360_000 }).status, 'near_limit');
  assert.equal(buildContextStatus({ model: 'gpt-5', inputTokens: 401_000 }).status, 'overflow');
});

test('buildContextStatus uses the selected model context window', () => {
  const context = buildContextStatus({
    model: 'gpt-4',
    inputTokens: 8_300,
  });

  assert.equal(context.status, 'overflow');
  assert.equal(context.contextWindow, 8_192);
  assert.equal(context.modelContextWindow, 8_192);
});

test('buildContextStatus supports gpt-3.5-turbo 16k context', () => {
  const context = buildContextStatus({
    model: 'gpt-3.5-turbo',
    inputTokens: 16_500,
  });

  assert.equal(context.status, 'overflow');
  assert.equal(context.contextWindow, 16_385);
  assert.equal(context.maxOutputTokens, 4_096);
});

test('buildUsageStats keeps tokenReport and uses API usage for model output', () => {
  const usage = buildUsageStats({
    model: 'gpt-5-mini',
    responseUsage: {
      input_tokens: 500,
      input_tokens_details: {
        cached_tokens: 100,
      },
      output_tokens: 50,
      output_tokens_details: {
        reasoning_tokens: 20,
      },
      total_tokens: 550,
    },
    tokenReport: {
      currentRequestTokens: 20,
      historyTokens: 480,
      fullInputTokens: 500,
    },
  });

  assert.equal(usage.inputTokens, 500);
  assert.equal(usage.outputTokens, 50);
  assert.equal(usage.reasoningTokens, 20);
  assert.equal(usage.tokenReport.currentRequestTokens, 20);
  assert.equal(usage.cost.estimatedUsd, 0.0002025);
});

test('buildCumulativeUsage sums previous agent usage and current usage', () => {
  const currentUsage = {
    inputTokens: 20,
    cachedInputTokens: 0,
    outputTokens: 5,
    reasoningTokens: 1,
    totalTokens: 25,
    cost: {
      estimatedUsd: 0.002,
    },
  };
  const cumulative = buildCumulativeUsage({
    history: [
      {
        role: 'agent',
        metadata: {
          usage: {
            inputTokens: 100,
            cachedInputTokens: 10,
            outputTokens: 30,
            reasoningTokens: 4,
            totalTokens: 130,
            cost: {
              estimatedUsd: 0.01,
            },
          },
        },
      },
      {
        role: 'user',
        text: 'No usage here',
      },
    ],
    currentUsage,
  });

  assert.deepEqual(cumulative, {
    inputTokens: 120,
    cachedInputTokens: 10,
    outputTokens: 35,
    reasoningTokens: 5,
    totalTokens: 155,
    estimatedUsd: 0.012,
  });
});

test('TokenUsageAnalyzer uses the token-counting endpoint when it is available', async () => {
  const analyzer = new TokenUsageAnalyzer({
    apiKey: 'test-key',
    model: 'gpt-5',
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);

      return {
        ok: true,
        async json() {
          return {
            input_tokens: Array.isArray(body.input) ? body.input.length * 10 : 7,
          };
        },
      };
    },
  });

  const report = await analyzer.buildTokenReport({
    systemInput: [{ role: 'system', content: 'Be concise.' }],
    conversationHistoryInput: [],
    historyInput: [{ role: 'system', content: 'Be concise.' }],
    currentInput: [{ role: 'user', content: 'Hello' }],
    fullInput: [
      { role: 'system', content: 'Be concise.' },
      { role: 'user', content: 'Hello' },
    ],
  });

  assert.equal(report.systemInstructionTokens, 10);
  assert.equal(report.conversationHistoryTokens, 0);
  assert.equal(report.currentRequestTokens, 10);
  assert.equal(report.historyTokens, 10);
  assert.equal(report.fullInputTokens, 20);
  assert.equal(report.countingMethod, 'api');
});
