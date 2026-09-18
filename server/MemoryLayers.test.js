import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MemoryLayers,
  normalizeLongTermMemory,
  normalizeUserProfile,
  normalizeWorkingMemory,
} from './MemoryLayers.js';

const shortTermMessages = [
  { role: 'user', text: 'Message 1' },
  { role: 'agent', text: 'Message 2' },
  { role: 'user', text: 'Message 3' },
  { role: 'agent', text: 'Message 4' },
  { role: 'user', text: 'Message 5' },
];

test('MemoryLayers normalizes fixed working and long-term keys', () => {
  assert.deepEqual(normalizeWorkingMemory({ goal: 'Build agent' }), {
    goal: 'Build agent',
    taskData: '',
    constraints: '',
    openQuestions: '',
    nextSteps: '',
  });
  assert.deepEqual(normalizeLongTermMemory({ preferences: ['Short', 'Russian'] }), {
    profile: '',
    preferences: 'Short; Russian',
    decisions: '',
    knowledge: '',
  });
  assert.equal(
    normalizeLongTermMemory({
      knowledge: {
        stack: 'React',
        rule: {
          memory: 'explicit layers',
        },
      },
    }).knowledge,
    'stack: React; rule: memory: explicit layers',
  );
});

test('MemoryLayers normalizes user profiles with safe defaults', () => {
  assert.deepEqual(normalizeUserProfile({ name: 'Учебный', constraints: ['Без жаргона'] }), {
    id: '',
    name: 'Учебный',
    description: '',
    style: '',
    format: '',
    constraints: 'Без жаргона',
    isActive: false,
    updatedAt: null,
  });
  assert.equal(normalizeUserProfile(null).name, '');
});

test('MemoryLayers builds context in profile, long-term, working, short-term order', () => {
  const memory = new MemoryLayers({ model: 'gpt-5-nano' });
  const prepared = memory.previewContext({
    shortTermMessages,
    workingMemory: {
      goal: 'Ship Day 11',
      taskData: 'Memory layers app',
      constraints: '',
      openQuestions: '',
      nextSteps: '',
    },
    longTermMemory: {
      profile: 'User builds AI Advent tasks',
      preferences: 'Russian UI',
      decisions: '',
      knowledge: '',
    },
    activeProfile: {
      id: 'learning',
      name: 'Learning',
      style: 'Explain carefully',
      isActive: true,
    },
    settings: {
      shortTermLimit: 2,
    },
  });

  assert.match(prepared.conversationHistoryInput[0].content, /Active user profile/);
  assert.match(prepared.conversationHistoryInput[0].content, /Explain carefully/);
  assert.match(prepared.conversationHistoryInput[0].content, /latest user message/);
  assert.match(prepared.conversationHistoryInput[1].content, /Long-term memory/);
  assert.match(prepared.conversationHistoryInput[1].content, /Russian UI/);
  assert.match(prepared.conversationHistoryInput[2].content, /Working memory/);
  assert.match(prepared.conversationHistoryInput[2].content, /Ship Day 11/);
  assert.deepEqual(prepared.conversationHistoryInput.slice(3), [
    { role: 'assistant', content: 'Message 4' },
    { role: 'user', content: 'Message 5' },
  ]);
  assert.equal(prepared.stats.shortTermSentCount, 2);
  assert.equal(prepared.stats.shortTermDroppedCount, 3);
  assert.equal(prepared.stats.profilePresent, true);
  assert.ok(prepared.stats.profileCharacters > 0);
});

test('MemoryLayers handles an empty or invalid profile', () => {
  const prepared = new MemoryLayers({ model: 'gpt-5-nano' }).previewContext({
    activeProfile: null,
  });

  assert.match(prepared.conversationHistoryInput[0].content, /No saved memory/);
  assert.equal(prepared.stats.profilePresent, false);
});

test('MemoryLayers updates layers from model JSON and reports changed keys', async () => {
  let receivedInput = null;
  const memory = new MemoryLayers({
    model: 'gpt-5-nano',
    client: {
      responses: {
        create: async ({ input }) => {
          receivedInput = input;

          return {
            output_text: JSON.stringify({
              workingMemory: {
                goal: 'Updated current goal',
                constraints: 'No extra services',
              },
              longTermMemory: {
                profile: 'Builds AI Advent learning apps',
                preferences: 'Short answers',
                decisions: 'Use explicit memory layers',
              },
            }),
          };
        },
      },
    },
  });

  const update = await memory.updateMemory({
    workingMemory: {},
    longTermMemory: {},
    shortTermMessages: [{ role: 'user', text: 'Я делаю AI Advent как учебные веб-приложения.' }],
    userMessage: 'Remember this',
    agentAnswer: 'Done',
  });

  assert.equal(update.workingMemory.goal, 'Updated current goal');
  assert.equal(update.workingMemory.constraints, 'No extra services');
  assert.equal(update.longTermMemory.profile, 'Builds AI Advent learning apps');
  assert.equal(update.longTermMemory.preferences, 'Short answers');
  assert.equal(update.longTermMemory.decisions, 'Use explicit memory layers');
  assert.deepEqual(update.changes.workingMemory, ['goal', 'constraints']);
  assert.deepEqual(update.changes.longTermMemory, ['profile', 'preferences', 'decisions']);
  assert.match(receivedInput[0].content, /profile: stable identity\/context facts/);
  assert.match(receivedInput[0].content, /decisions: durable decisions/);
  assert.match(receivedInput[0].content, /If the user reveals interests or likes/);
  assert.match(receivedInput[0].content, /assistant answer contains reusable advice/);
  assert.match(receivedInput[1].content, /Recent short-term transcript/);
  assert.match(receivedInput[1].content, /AI Advent/);
});

test('MemoryLayers keeps existing memory when extraction JSON is invalid', async () => {
  const memory = new MemoryLayers({
    model: 'gpt-5-nano',
    client: {
      responses: {
        create: async () => ({
          output_text: 'not json',
        }),
      },
    },
  });

  const update = await memory.updateMemory({
    workingMemory: {
      goal: 'Existing goal',
    },
    longTermMemory: {
      profile: 'Existing profile',
    },
    userMessage: 'Hello',
    agentAnswer: 'Hi',
  });

  assert.equal(update.workingMemory.goal, 'Existing goal');
  assert.equal(update.longTermMemory.profile, 'Existing profile');
  assert.deepEqual(update.changes.workingMemory, []);
  assert.deepEqual(update.changes.longTermMemory, []);
});
