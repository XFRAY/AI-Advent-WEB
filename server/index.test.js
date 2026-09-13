import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from './index.js';
import { LlmAgent } from './LlmAgent.js';
import { MessageStore } from './MessageStore.js';

test('API compares the three Day 10 strategies with a mocked model', async () => {
  const { baseUrl, calls, close } = await startTestServer();

  try {
    const response = await fetch(`${baseUrl}/api/chat/compare`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: 'Цель: собрать ТЗ без summary.',
        settings: {
          lastMessagesCount: 2,
        },
      }),
    });
    const data = await response.json();

    assert.equal(response.status, 200);
    assert.equal(data.sliding.messages.length, 2);
    assert.equal(data.facts.facts.goal, 'Mock goal');
    assert.equal(data.branching.branchingState.activeBranchId, 'main');
    assert.equal(data.comparison.sliding.fullInputTokens, 20);
    assert.equal(data.comparison.facts.fullInputTokens, 20);
    assert.equal(data.comparison.branching.fullInputTokens, 20);

    const factsAnswerCallIndex = calls.findIndex((call) =>
      call.input.some((item) => item.content?.startsWith('Sticky facts from earlier conversation')),
    );
    const factsExtractionCallIndex = calls.findIndex((call) =>
      call.input[0]?.content?.startsWith('Extract durable key-value facts'),
    );
    const factsAnswerCall = calls[factsAnswerCallIndex];
    const stickyFactsInput = factsAnswerCall.input.find((item) =>
      item.content?.startsWith('Sticky facts from earlier conversation'),
    );

    assert.ok(factsAnswerCallIndex >= 0);
    assert.ok(factsExtractionCallIndex > factsAnswerCallIndex);
    assert.match(stickyFactsInput.content, /No facts captured yet/);
    assert.doesNotMatch(stickyFactsInput.content, /Mock goal/);
  } finally {
    await close();
  }
});

test('API creates and switches Branching checkpoint branches', async () => {
  const { baseUrl, close } = await startTestServer();

  try {
    await fetch(`${baseUrl}/api/chat/compare`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: 'Common setup',
        settings: {
          lastMessagesCount: 4,
        },
      }),
    });

    const checkpointResponse = await fetch(`${baseUrl}/api/branching/checkpoint`, {
      method: 'POST',
    });
    const checkpoint = await checkpointResponse.json();

    assert.equal(checkpoint.branchingState.activeBranchId, 'A');
    assert.equal(checkpoint.branchingMessages.length, 2);

    const switchResponse = await fetch(`${baseUrl}/api/branching/active-branch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ branchId: 'B' }),
    });
    const switched = await switchResponse.json();

    assert.equal(switchResponse.status, 200);
    assert.equal(switched.branchingState.activeBranchId, 'B');
    assert.deepEqual(
      switched.branchingMessages.map((message) => message.text),
      ['Common setup', 'Mock answer'],
    );
  } finally {
    await close();
  }
});

async function startTestServer() {
  const databasePath = path.join(
    os.tmpdir(),
    `ai-advent-api-${Date.now()}-${Math.random()}.sqlite`,
  );
  const agent = new LlmAgent({ apiKey: 'test-key', model: 'gpt-5-nano' });
  const calls = [];

  agent.client = {
    responses: {
      create: async ({ input }) => {
        calls.push({ input });

        if (input[0]?.content?.startsWith('Extract durable key-value facts')) {
          return {
            output_text: JSON.stringify({
              goal: 'Mock goal',
              constraints: 'Mock constraints',
              preferences: '',
              decisions: '',
              openQuestions: '',
              agreements: '',
            }),
            usage: {
              input_tokens: 8,
              output_tokens: 4,
              total_tokens: 12,
            },
          };
        }

        return {
          output_text: 'Mock answer',
          usage: {
            input_tokens: 20,
            output_tokens: 5,
            total_tokens: 25,
          },
        };
      },
    },
  };
  agent.tokenUsageAnalyzer = {
    async buildTokenReport() {
      return {
        systemInstructionTokens: 4,
        conversationHistoryTokens: 10,
        currentRequestTokens: 6,
        historyTokens: 14,
        fullInputTokens: 20,
        countingMethod: 'fallback',
        context: {
          status: 'ok',
          inputTokens: 20,
          contextWindow: 400_000,
          remainingInputTokens: 399_980,
        },
      };
    },
  };

  const app = createApp({
    agent,
    messageStore: new MessageStore({ databasePath }),
  });
  const server = http.createServer(app);

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();

  return {
    baseUrl: `http://${address.address}:${address.port}`,
    calls,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      }),
  };
}
