import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from './index.js';
import { LlmAgent } from './LlmAgent.js';
import { MessageStore } from './MessageStore.js';

test('API stores explicit memory layers with a mocked model', async () => {
  const { baseUrl, calls, close } = await startTestServer();

  try {
    const firstResponse = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: 'Цель: сделать 11 день. Я предпочитаю короткие ответы.',
        settings: {
          shortTermLimit: 4,
        },
      }),
    });
    const first = await firstResponse.json();

    assert.equal(firstResponse.status, 200);
    assert.equal(first.shortTermMessages.length, 2);
    assert.equal(first.memoryUpdateStatus, 'pending');

    const memoryAfterFirst = await waitForMemory(baseUrl, (memoryData) =>
      memoryData.workingMemory?.goal === 'Mock working goal',
    );

    assert.equal(memoryAfterFirst.workingMemory.goal, 'Mock working goal');
    assert.equal(memoryAfterFirst.longTermMemory.preferences, 'Mock durable preference');

    await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: 'Что ты помнишь?',
        settings: {
          shortTermLimit: 4,
        },
      }),
    });

    const secondAnswerCall = calls.filter((call) => call.kind === 'answer').at(-1);
    const longTermInput = secondAnswerCall.input.find((item) =>
      item.content?.startsWith('Long-term memory'),
    );
    const workingInput = secondAnswerCall.input.find((item) =>
      item.content?.startsWith('Working memory'),
    );

    assert.match(longTermInput.content, /Mock durable preference/);
    assert.match(workingInput.content, /Mock working goal/);
    assert.ok(
      secondAnswerCall.input.findIndex((item) => item.content?.startsWith('Long-term memory')) <
        secondAnswerCall.input.findIndex((item) => item.content?.startsWith('Working memory')),
    );
  } finally {
    await close();
  }
});

test('API clears all Day 11 memory layers', async () => {
  const { baseUrl, close } = await startTestServer();

  try {
    await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: 'Save something',
      }),
    });

    const clearResponse = await fetch(`${baseUrl}/api/memory`, {
      method: 'DELETE',
    });
    const cleared = await clearResponse.json();

    assert.equal(clearResponse.status, 200);
    assert.deepEqual(cleared.shortTermMessages, []);
    assert.equal(cleared.workingMemory.goal, '');
    assert.equal(cleared.longTermMemory.preferences, '');

    await sleep(20);

    const memoryResponse = await fetch(`${baseUrl}/api/memory`);
    const memory = await memoryResponse.json();

    assert.equal(memory.workingMemory.goal, '');
    assert.equal(memory.longTermMemory.preferences, '');
  } finally {
    await close();
  }
});

async function waitForMemory(baseUrl, predicate) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/memory`);
    const data = await response.json();

    if (predicate(data)) {
      return data;
    }

    await sleep(10);
  }

  throw new Error('Timed out waiting for memory update');
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

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
        if (input[0]?.content?.startsWith('Update an explicit memory model')) {
          calls.push({ kind: 'memory', input });

          return {
            output_text: JSON.stringify({
              workingMemory: {
                goal: 'Mock working goal',
                taskData: 'Mock task data',
                constraints: '',
                openQuestions: '',
                nextSteps: '',
              },
              longTermMemory: {
                profile: '',
                preferences: 'Mock durable preference',
                decisions: 'Mock durable decision',
                knowledge: '',
              },
            }),
            usage: {
              input_tokens: 8,
              output_tokens: 4,
              total_tokens: 12,
            },
          };
        }

        calls.push({ kind: 'answer', input });

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
