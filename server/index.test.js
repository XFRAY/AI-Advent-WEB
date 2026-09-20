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
    const clearResponse = await fetch(`${baseUrl}/api/memory`, {
      method: 'DELETE',
    });
    const cleared = await clearResponse.json();

    assert.equal(clearResponse.status, 200);
    assert.deepEqual(cleared.shortTermMessages, []);
    assert.equal(cleared.workingMemory.goal, '');
    assert.equal(cleared.longTermMemory.preferences, '');
    assert.equal(cleared.activeProfile.id, 'concise-business');

    await sleep(20);

    const memoryResponse = await fetch(`${baseUrl}/api/memory`);
    const memory = await memoryResponse.json();

    assert.equal(memory.workingMemory.goal, '');
    assert.equal(memory.longTermMemory.preferences, '');
    assert.equal(memory.activeProfile.id, 'concise-business');

  } finally {
    await close();
  }
});

test('invariants API persists rules and chat sends them before memory', async () => {
  const { baseUrl, calls, close } = await startTestServer();

  try {
    const saveResponse = await fetch(`${baseUrl}/api/invariants`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        invariants: {
          architecture: 'Использовать модульную архитектуру',
          technicalDecisions: 'REST API',
        },
      }),
    });
    const saved = await saveResponse.json();
    assert.equal(saveResponse.status, 200);
    assert.equal(saved.stats.activeCount, 2);

    const chatResponse = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Объясни текущую архитектуру' }),
    });
    assert.equal(chatResponse.status, 200);

    const answerCall = calls.find((call) => call.kind === 'answer');
    const invariantIndex = answerCall.input.findIndex((item) =>
      item.content?.startsWith('Mandatory invariants'),
    );
    const lifecycleIndex = answerCall.input.findIndex((item) =>
      item.content?.startsWith('Controlled task lifecycle'),
    );
    const profileIndex = answerCall.input.findIndex((item) =>
      item.content?.startsWith('Active user profile'),
    );

    assert.equal(invariantIndex, 1);
    assert.equal(lifecycleIndex, 2);
    assert.match(answerCall.input[lifecycleIndex].content, /PLANNING-ONLY RULE/);
    assert.match(answerCall.input[lifecycleIndex].content, /Do not provide source code/);
    assert.ok(invariantIndex < lifecycleIndex);
    assert.ok(lifecycleIndex < profileIndex);
  } finally {
    await close();
  }
});

test('conflicting chat request returns 409 without calling the model', async () => {
  const { baseUrl, calls, close } = await startTestServer();

  try {
    await fetch(`${baseUrl}/api/invariants`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stackConstraints: 'Не использовать Python' }),
    });
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Используй Python для нового сервиса' }),
    });
    const data = await response.json();

    assert.equal(response.status, 409);
    assert.equal(data.code, 'INVARIANT_CONFLICT');
    assert.equal(data.conflict.field, 'stackConstraints');
    assert.match(data.error, /Не использовать Python/);
    assert.equal(calls.filter((call) => call.kind === 'answer').length, 0);
  } finally {
    await close();
  }
});

test('clearing memory preserves invariants', async () => {
  const { baseUrl, close } = await startTestServer();

  try {
    await fetch(`${baseUrl}/api/invariants`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessRules: 'Не публиковать черновики' }),
    });
    await fetch(`${baseUrl}/api/memory`, { method: 'DELETE' });

    const response = await fetch(`${baseUrl}/api/invariants`);
    const data = await response.json();
    assert.equal(data.invariants.businessRules, 'Не публиковать черновики');
    assert.equal(data.stats.activeCount, 1);
  } finally {
    await close();
  }
});

test('lifecycle blocks implementation before plan approval without calling the model', async () => {
  const { baseUrl, calls, close } = await startTestServer();

  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Начни реализацию' }),
    });
    const data = await response.json();

    assert.equal(response.status, 409);
    assert.equal(data.code, 'LIFECYCLE_TRANSITION_BLOCKED');
    assert.equal(data.taskLifecycle.stage, 'planning');
    assert.equal(calls.filter((call) => call.kind === 'answer').length, 0);
  } finally {
    await close();
  }
});

test('lifecycle blocks an explicit jump from planning directly to done', async () => {
  const { baseUrl, calls, close } = await startTestServer();

  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Переходи сразу в done' }),
    });
    const data = await response.json();

    assert.equal(response.status, 409);
    assert.equal(data.code, 'LIFECYCLE_TRANSITION_BLOCKED');
    assert.equal(data.intent, 'finalize');
    assert.equal(data.taskLifecycle.stage, 'planning');
    assert.match(data.error, /до этапа валидации/);
    assert.equal(calls.filter((call) => call.kind === 'answer').length, 0);
  } finally {
    await close();
  }
});

test('pure lifecycle transition persists state and deterministic assistant response', async () => {
  const { baseUrl, calls, close } = await startTestServer();

  try {
    await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Составь план работы' }),
    });
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Утверждаю план' }),
    });
    const data = await response.json();

    assert.equal(response.status, 200);
    assert.equal(data.taskLifecycle.stage, 'implementation');
    assert.deepEqual(data.taskLifecycle.allowedTransitions, [
      { from: 'implementation', to: 'planning', intent: 'replan' },
      { from: 'implementation', to: 'planning', intent: 'reset' },
    ]);
    assert.equal(data.agentMessage.metadata.deterministic, true);
    assert.match(data.answer, /План утверждён/);
    assert.equal(calls.filter((call) => call.kind === 'answer').length, 1);

    const stateResponse = await fetch(`${baseUrl}/api/task-lifecycle`);
    const persisted = await stateResponse.json();
    assert.equal(persisted.taskLifecycle.stage, 'implementation');
  } finally {
    await close();
  }
});

test('short approval command moves a saved plan to implementation', async () => {
  const { baseUrl, calls, close } = await startTestServer();

  try {
    await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Составь план' }),
    });
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'утверждаю' }),
    });
    const data = await response.json();

    assert.equal(response.status, 200);
    assert.equal(data.taskLifecycle.stage, 'implementation');
    assert.equal(data.agentMessage.metadata.deterministic, true);
    assert.equal(calls.filter((call) => call.kind === 'answer').length, 1);
  } finally {
    await close();
  }
});

test('lifecycle remains on the persisted stage after a break between requests', async () => {
  const { baseUrl, close } = await startTestServer();

  try {
    for (const message of ['Составь план', 'Утверждаю план']) {
      await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
    }

    await sleep(20);
    const stateResponse = await fetch(`${baseUrl}/api/task-lifecycle`);
    const state = await stateResponse.json();
    assert.equal(state.taskLifecycle.stage, 'implementation');
    assert.deepEqual(state.taskLifecycle.allowedTransitions, [
      { from: 'implementation', to: 'planning', intent: 'replan' },
      { from: 'implementation', to: 'planning', intent: 'reset' },
    ]);
  } finally {
    await close();
  }
});

test('clearing memory resets lifecycle while preserving invariants and profiles', async () => {
  const { baseUrl, close } = await startTestServer();

  try {
    await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Составь план' }),
    });
    await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Утверждаю план' }),
    });
    const response = await fetch(`${baseUrl}/api/memory`, { method: 'DELETE' });
    const data = await response.json();

    assert.equal(data.taskLifecycle.stage, 'planning');
    assert.equal(data.taskLifecycle.artifacts.plan, null);
    assert.equal(data.activeProfile.id, 'concise-business');
  } finally {
    await close();
  }
});

test('full lifecycle passes through every stage and rejects each jump without calling the model', async () => {
  const { baseUrl, calls, close } = await startTestServer();
  const modelCalls = () => calls.filter((call) => call.kind === 'answer').length;

  try {
    const jump = async (message, stage) => {
      const before = modelCalls();
      const { status, data } = await chat(baseUrl, message);
      assert.equal(status, 409, message);
      assert.equal(data.code, 'LIFECYCLE_TRANSITION_BLOCKED', message);
      assert.equal(data.taskLifecycle.stage, stage, message);
      assert.equal(modelCalls(), before, message);
    };

    await jump('Финализируй задачу', 'planning');
    assert.equal((await chat(baseUrl, 'Составь план реализации')).data.taskLifecycle.stage, 'planning');
    await jump('Проверь реализацию', 'planning');
    assert.equal((await chat(baseUrl, 'Утверждаю план')).data.taskLifecycle.stage, 'implementation');
    await jump('Финализируй задачу', 'implementation');
    await jump('Проверь реализацию', 'implementation');
    assert.equal((await chat(baseUrl, 'Реализуй план')).data.taskLifecycle.stage, 'implementation');
    assert.equal((await chat(baseUrl, 'Проверь реализацию')).data.taskLifecycle.stage, 'validation');
    await jump('Утверждаю план', 'validation');
    const done = await chat(baseUrl, 'Финализируй задачу');
    assert.equal(done.status, 200);
    assert.equal(done.data.taskLifecycle.stage, 'done');
    await jump('Реализуй ещё что-нибудь', 'done');
    assert.equal((await chat(baseUrl, 'Сбросить')).data.taskLifecycle.stage, 'planning');
  } finally {
    await close();
  }
});

test('rework asks the model to fix validation findings and passes the user text along', async () => {
  const { baseUrl, calls, close } = await startTestServer();
  const answerCalls = () => calls.filter((call) => call.kind === 'answer');

  try {
    for (const message of ['Составь план', 'Утверждаю план', 'Реализуй план', 'Проверь реализацию']) {
      await chat(baseUrl, message);
    }
    const before = answerCalls().length;
    const rework = await chat(baseUrl, 'Доработать: добавь проверку пустого ввода');

    assert.equal(rework.status, 200);
    assert.equal(answerCalls().length, before + 1);
    assert.equal(rework.data.taskLifecycle.stage, 'implementation');
    assert.equal(rework.data.taskLifecycle.artifacts.implementationResults.length, 1);
    assert.equal(rework.data.taskLifecycle.artifacts.validationResults.length, 0);

    const input = answerCalls().at(-1).input;
    assert.match(input.find((item) => item.content?.startsWith('Controlled task lifecycle')).content, /REWORK REQUESTED[\s\S]*Mock answer/);
    assert.ok(input.some((item) => item.content?.includes('добавь проверку пустого ввода')));

    assert.equal((await chat(baseUrl, 'Финализируй задачу')).status, 409);
    assert.equal((await chat(baseUrl, 'Проверь реализацию')).data.taskLifecycle.stage, 'validation');
    assert.equal((await chat(baseUrl, 'Финализируй задачу')).data.taskLifecycle.stage, 'done');
  } finally {
    await close();
  }
});

test('lifecycle resumes from the saved stage after the server restarts', async () => {
  const first = await startTestServer();
  let second;

  try {
    for (const message of ['Составь план', 'Утверждаю план', 'Реализуй план']) {
      await chat(first.baseUrl, message);
    }
    await first.close();

    second = await startTestServer({ databasePath: first.databasePath });
    const state = await (await fetch(`${second.baseUrl}/api/task-lifecycle`)).json();
    assert.equal(state.taskLifecycle.stage, 'implementation');
    assert.equal(state.taskLifecycle.artifacts.implementationResults.length, 1);
    assert.equal((await chat(second.baseUrl, 'Финализируй задачу')).status, 409);

    assert.equal((await chat(second.baseUrl, 'Проверь реализацию')).data.taskLifecycle.stage, 'validation');
    assert.equal((await chat(second.baseUrl, 'Финализируй задачу')).data.taskLifecycle.stage, 'done');
  } finally {
    await second?.close();
  }
});

test('approved plan is sent to the model and can be changed only by returning to planning', async () => {
  const { baseUrl, calls, close } = await startTestServer();
  const answerCalls = () => calls.filter((call) => call.kind === 'answer');

  try {
    await chat(baseUrl, 'Составь план');
    await chat(baseUrl, 'Утверждаю план');
    await chat(baseUrl, 'Поменяй хранение на файл');

    const lifecycleInput = answerCalls().at(-1).input.find((item) => item.content?.startsWith('Controlled task lifecycle'));
    assert.match(lifecycleInput.content, /Approved plan \(source of truth\):\nMock answer/);
    assert.match(lifecycleInput.content, /«Пересмотреть план»/);

    const replan = await chat(baseUrl, 'Пересмотреть план');
    const before = answerCalls().length;
    assert.equal(replan.status, 200);
    assert.equal(replan.data.taskLifecycle.stage, 'planning');
    assert.equal(replan.data.agentMessage.metadata.deterministic, true);
    assert.equal(replan.data.taskLifecycle.artifacts.implementationResults.length, 0);

    const approveAgain = await chat(baseUrl, 'Утверждаю план');
    assert.equal(approveAgain.status, 409);
    assert.equal(approveAgain.data.taskLifecycle.stage, 'planning');
    assert.equal(answerCalls().length, before);

    await chat(baseUrl, 'Хранение в файле вместо памяти');
    const approved = await chat(baseUrl, 'Утверждаю план');
    assert.equal(approved.status, 200);
    assert.equal(approved.data.taskLifecycle.stage, 'implementation');
  } finally {
    await close();
  }
});

async function chat(baseUrl, message) {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });

  return { status: response.status, data: await response.json() };
}

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

async function startTestServer({
  databasePath = path.join(os.tmpdir(), `ai-advent-api-${Date.now()}-${Math.random()}.sqlite`),
} = {}) {
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
    databasePath,
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
