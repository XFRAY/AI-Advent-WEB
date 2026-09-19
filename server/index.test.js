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
    const profileInput = secondAnswerCall.input.find((item) =>
      item.content?.startsWith('Active user profile'),
    );

    assert.match(profileInput.content, /Краткий деловой/);
    assert.match(longTermInput.content, /Mock durable preference/);
    assert.match(workingInput.content, /Mock working goal/);
    assert.ok(
      secondAnswerCall.input.findIndex((item) => item.content?.startsWith('Active user profile')) <
        secondAnswerCall.input.findIndex((item) => item.content?.startsWith('Long-term memory')),
    );
    assert.ok(
      secondAnswerCall.input.findIndex((item) => item.content?.startsWith('Long-term memory')) <
        secondAnswerCall.input.findIndex((item) => item.content?.startsWith('Working memory')),
    );
  } finally {
    await close();
  }
});

test('API lists, edits, and switches profiles for subsequent model requests', async () => {
  const { baseUrl, calls, close } = await startTestServer();

  try {
    const profilesResponse = await fetch(`${baseUrl}/api/profiles`);
    const initial = await profilesResponse.json();

    assert.equal(profilesResponse.status, 200);
    assert.equal(initial.profiles.length, 2);
    assert.equal(initial.activeProfile.id, 'concise-business');

    await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Explain profiles briefly' }),
    });
    const conciseCall = calls.filter((call) => call.kind === 'answer').at(-1);
    const conciseBlock = conciseCall.input.find((item) =>
      item.content?.startsWith('Active user profile'),
    );

    const updateResponse = await fetch(`${baseUrl}/api/profiles/detailed-learning`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ style: 'Объяснять подробно и с аналогиями.' }),
    });
    assert.equal(updateResponse.status, 200);

    const activateResponse = await fetch(
      `${baseUrl}/api/profiles/detailed-learning/activate`,
      { method: 'POST' },
    );
    const activated = await activateResponse.json();
    assert.equal(activated.activeProfile.id, 'detailed-learning');

    await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Explain profiles again' }),
    });
    const learningCall = calls.filter((call) => call.kind === 'answer').at(-1);
    const learningBlock = learningCall.input.find((item) =>
      item.content?.startsWith('Active user profile'),
    );

    assert.notEqual(conciseBlock.content, learningBlock.content);
    assert.match(conciseBlock.content, /Краткий деловой/);
    assert.match(learningBlock.content, /Объяснять подробно и с аналогиями/);

    const previewResponse = await fetch(`${baseUrl}/api/context-preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Preview' }),
    });
    const preview = await previewResponse.json();

    assert.equal(preview.activeProfile.id, 'detailed-learning');
    assert.equal(preview.stats.profilePresent, true);
    assert.ok(preview.stats.profileCharacters > 0);
  } finally {
    await close();
  }
});

test('API compares the same prompt through every profile without saving duplicate dialogue', async () => {
  const { baseUrl, calls, close } = await startTestServer();

  try {
    const response = await fetch(`${baseUrl}/api/profile-comparison`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Explain event loop' }),
    });
    const comparison = await response.json();

    assert.equal(response.status, 200);
    assert.equal(comparison.comparison.results.length, 2);
    assert.deepEqual(
      comparison.comparison.results.map((result) => result.profile.id),
      ['concise-business', 'detailed-learning'],
    );

    const answerCalls = calls.filter((call) => call.kind === 'answer');
    const profileBlocks = answerCalls.map(
      (call) => call.input.find((item) => item.content?.startsWith('Active user profile')).content,
    );

    assert.match(profileBlocks[0], /Краткий деловой/);
    assert.match(profileBlocks[1], /Подробный учебный/);

    await fetch(`${baseUrl}/api/profile-comparison`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Which loop should I use?' }),
    });
    const followUpCalls = calls.filter((call) => call.kind === 'answer').slice(-2);
    for (const call of followUpCalls) {
      assert.ok(call.input.some((item) => item.role === 'user' && item.content === 'Explain event loop'));
      assert.ok(call.input.some((item) => item.role === 'assistant' && item.content === 'Mock answer'));
    }

    const memoryResponse = await fetch(`${baseUrl}/api/memory`);
    const memory = await memoryResponse.json();
    assert.equal(memory.shortTermMessages.length, 0);

    const historyResponse = await fetch(`${baseUrl}/api/profile-comparisons`);
    const history = await historyResponse.json();
    assert.equal(history.comparisons.length, 2);
    assert.equal(history.comparisons[0].question, 'Explain event loop');

    await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Temporary memory' }),
    });

    const clearResponse = await fetch(`${baseUrl}/api/profile-comparisons`, { method: 'DELETE' });
    const cleared = await clearResponse.json();
    assert.deepEqual(cleared.comparisons, []);
    const clearedMemoryResponse = await fetch(`${baseUrl}/api/memory`);
    const clearedMemory = await clearedMemoryResponse.json();
    assert.deepEqual(clearedMemory.shortTermMessages, []);
    assert.equal(clearedMemory.workingMemory.goal, '');
    assert.equal(clearedMemory.longTermMemory.preferences, '');
    assert.equal(clearedMemory.activeProfile.id, 'concise-business');
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
    await fetch(`${baseUrl}/api/task-state/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'advance' }),
    });

    const clearResponse = await fetch(`${baseUrl}/api/memory`, {
      method: 'DELETE',
    });
    const cleared = await clearResponse.json();

    assert.equal(clearResponse.status, 200);
    assert.deepEqual(cleared.shortTermMessages, []);
    assert.equal(cleared.workingMemory.goal, '');
    assert.equal(cleared.longTermMemory.preferences, '');
    assert.equal(cleared.activeProfile.id, 'concise-business');
    assert.equal(cleared.taskState.stage, 'planning');
    assert.equal(cleared.taskState.isPaused, false);

    await sleep(20);

    const memoryResponse = await fetch(`${baseUrl}/api/memory`);
    const memory = await memoryResponse.json();

    assert.equal(memory.workingMemory.goal, '');
    assert.equal(memory.longTermMemory.preferences, '');
    assert.equal(memory.activeProfile.id, 'concise-business');

    const taskStateResponse = await fetch(`${baseUrl}/api/task-state`);
    const taskStateData = await taskStateResponse.json();
    assert.equal(taskStateData.taskState.stage, 'planning');
  } finally {
    await close();
  }
});

test('API persists task state events and blocks advance while paused', async () => {
  const { baseUrl, close } = await startTestServer();

  try {
    const initialResponse = await fetch(`${baseUrl}/api/task-state`);
    const initial = await initialResponse.json();
    assert.equal(initial.taskState.stage, 'planning');
    assert.equal(initial.taskState.currentStep, 'Сформулировать задачу');

    await fetch(`${baseUrl}/api/task-state/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'advance' }),
    });
    await fetch(`${baseUrl}/api/task-state/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'pause' }),
    });
    const blockedResponse = await fetch(`${baseUrl}/api/task-state/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'advance' }),
    });
    const blocked = await blockedResponse.json();
    assert.equal(blocked.taskState.stage, 'execution');
    assert.equal(blocked.taskState.isPaused, true);

    const persistedResponse = await fetch(`${baseUrl}/api/task-state`);
    const persisted = await persistedResponse.json();
    assert.deepEqual(persisted.taskState, blocked.taskState);
  } finally {
    await close();
  }
});

test('chat sends task state to the model and stores it with the answer', async () => {
  const { baseUrl, calls, close } = await startTestServer();

  try {
    await fetch(`${baseUrl}/api/task-state/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'advance' }),
    });
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Продолжай работу' }),
    });
    const data = await response.json();
    const answerCall = calls.find((call) => call.kind === 'answer');
    const stateInput = answerCall.input.find((item) => item.content?.startsWith('Formal task state'));

    assert.equal(response.status, 200);
    assert.match(stateInput.content, /Stage: execution/);
    assert.equal(data.taskState.stage, 'execution');
    assert.equal(data.agentMessage.metadata.taskState.stage, 'execution');
  } finally {
    await close();
  }
});

test('chat is blocked while the task is paused', async () => {
  const { baseUrl, calls, close } = await startTestServer();

  try {
    await fetch(`${baseUrl}/api/task-state/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'pause' }),
    });
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Продолжай работу' }),
    });
    const data = await response.json();

    assert.equal(response.status, 409);
    assert.equal(data.taskState.isPaused, true);
    assert.match(data.error, /паузе/);
    assert.equal(calls.filter((call) => call.kind === 'answer').length, 0);
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
