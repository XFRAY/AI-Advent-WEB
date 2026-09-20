import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MessageStore } from './MessageStore.js';

test('MessageStore keeps full messages, compressed messages, and summary separately', () => {
  const databasePath = path.join(
    os.tmpdir(),
    `ai-advent-message-store-${Date.now()}-${Math.random()}.sqlite`,
  );
  const store = new MessageStore({ databasePath });

  store.addMessage({ mode: 'full', role: 'user', text: 'Full history message' });
  store.addMessage({ mode: 'compressed', role: 'user', text: 'Compressed history message' });
  store.saveSummary({
    mode: 'compressed',
    text: 'Compressed summary',
    summarizedMessageCount: 1,
    lastMessagesCount: 6,
    summaryBatchSize: 10,
  });

  assert.deepEqual(
    store.getMessages('full').map((message) => message.text),
    ['Full history message'],
  );
  assert.deepEqual(
    store.getMessages('compressed').map((message) => message.text),
    ['Compressed history message'],
  );
  assert.equal(store.getSummary('compressed').text, 'Compressed summary');
});

test('MessageStore trims Sliding Window messages physically', () => {
  const databasePath = path.join(
    os.tmpdir(),
    `ai-advent-message-store-trim-${Date.now()}-${Math.random()}.sqlite`,
  );
  const store = new MessageStore({ databasePath });

  store.addMessage({ mode: 'sliding', role: 'user', text: 'Message 1' });
  store.addMessage({ mode: 'sliding', role: 'agent', text: 'Message 2' });
  store.addMessage({ mode: 'sliding', role: 'user', text: 'Message 3' });
  store.addMessage({ mode: 'sliding', role: 'agent', text: 'Message 4' });

  const remaining = store.trimMessages({
    mode: 'sliding',
    keepCount: 2,
  });

  assert.deepEqual(
    remaining.map((message) => message.text),
    ['Message 3', 'Message 4'],
  );
  assert.deepEqual(
    store.getMessages('sliding').map((message) => message.text),
    ['Message 3', 'Message 4'],
  );
});

test('MessageStore creates independent Branching checkpoint branches', () => {
  const databasePath = path.join(
    os.tmpdir(),
    `ai-advent-message-store-branch-${Date.now()}-${Math.random()}.sqlite`,
  );
  const store = new MessageStore({ databasePath });

  store.addMessage({ mode: 'branching', role: 'user', text: 'Common question' });
  store.addMessage({ mode: 'branching', role: 'agent', text: 'Common answer' });

  const state = store.createBranchingCheckpoint();

  assert.equal(state.activeBranchId, 'A');
  assert.equal(state.checkpointMessageCount, 2);
  assert.deepEqual(
    store.getMessages('branching', { branchId: 'A' }).map((message) => message.text),
    ['Common question', 'Common answer'],
  );
  assert.deepEqual(
    store.getMessages('branching', { branchId: 'B' }).map((message) => message.text),
    ['Common question', 'Common answer'],
  );

  store.addMessage({ mode: 'branching', branchId: 'A', role: 'user', text: 'A only' });
  store.addMessage({ mode: 'branching', branchId: 'B', role: 'user', text: 'B only' });

  assert.deepEqual(
    store.getMessages('branching', { branchId: 'A' }).map((message) => message.text),
    ['Common question', 'Common answer', 'A only'],
  );
  assert.deepEqual(
    store.getMessages('branching', { branchId: 'B' }).map((message) => message.text),
    ['Common question', 'Common answer', 'B only'],
  );
});

test('MessageStore saves fixed Sticky Facts keys', () => {
  const databasePath = path.join(
    os.tmpdir(),
    `ai-advent-message-store-facts-${Date.now()}-${Math.random()}.sqlite`,
  );
  const store = new MessageStore({ databasePath });

  const facts = store.saveFacts({
    goal: 'Build agent',
    constraints: 'No summary',
  });

  assert.equal(facts.goal, 'Build agent');
  assert.equal(facts.constraints, 'No summary');
  assert.equal(facts.preferences, '');
  assert.deepEqual(store.getFacts(), facts);
});

test('MessageStore keeps short-term, working, and long-term memory separately', () => {
  const databasePath = path.join(
    os.tmpdir(),
    `ai-advent-message-store-memory-${Date.now()}-${Math.random()}.sqlite`,
  );
  const store = new MessageStore({ databasePath });

  store.addShortTermMessage({ role: 'user', text: 'Current dialogue message' });
  const workingMemory = store.saveWorkingMemory({
    goal: 'Implement Day 11',
    taskData: 'Memory layer demo',
  });
  const longTermMemory = store.saveLongTermMemory({
    profile: 'Builds AI Advent projects',
    preferences: 'Russian interface',
  });

  assert.deepEqual(
    store.getShortTermMessages().map((message) => message.text),
    ['Current dialogue message'],
  );
  assert.equal(workingMemory.goal, 'Implement Day 11');
  assert.equal(workingMemory.taskData, 'Memory layer demo');
  assert.equal(workingMemory.constraints, '');
  assert.equal(longTermMemory.profile, 'Builds AI Advent projects');
  assert.equal(longTermMemory.preferences, 'Russian interface');
  assert.equal(longTermMemory.decisions, '');
  assert.equal(store.getWorkingMemory().goal, 'Implement Day 11');
  assert.equal(store.getLongTermMemory().profile, 'Builds AI Advent projects');
});

test('MessageStore seeds, edits, switches, and preserves user profiles', () => {
  const databasePath = path.join(
    os.tmpdir(),
    `ai-advent-message-store-profiles-${Date.now()}-${Math.random()}.sqlite`,
  );
  const store = new MessageStore({ databasePath });

  assert.equal(store.getProfiles().length, 2);
  assert.equal(store.getActiveProfile().id, 'concise-business');

  const updated = store.updateUserProfile('detailed-learning', {
    style: 'Объяснять особенно подробно',
  });
  const active = store.setActiveProfile('detailed-learning');

  assert.equal(updated.style, 'Объяснять особенно подробно');
  assert.equal(active.id, 'detailed-learning');
  assert.equal(store.getProfiles().filter((profile) => profile.isActive).length, 1);

  store.clearMemory();
  assert.equal(store.getProfiles().length, 2);
  assert.equal(store.getActiveProfile().id, 'detailed-learning');
});

test('MessageStore persists and clears profile comparison history', () => {
  const databasePath = path.join(
    os.tmpdir(),
    `ai-advent-message-store-comparisons-${Date.now()}-${Math.random()}.sqlite`,
  );
  const store = new MessageStore({ databasePath });

  store.addProfileComparison({
    question: 'What is an event loop?',
    results: [{ profile: { id: 'concise-business' }, answer: 'Short answer' }],
  });

  assert.equal(store.getProfileComparisons().length, 1);
  assert.equal(store.getProfileComparisons()[0].question, 'What is an event loop?');
  assert.equal(store.getProfileComparisons()[0].results[0].answer, 'Short answer');

  store.clearProfileComparisons();
  assert.deepEqual(store.getProfileComparisons(), []);
  assert.equal(store.getProfiles().length, 2);
});

test('MessageStore starts without invariants, normalizes, persists, clears, and isolates them', () => {
  const databasePath = path.join(
    os.tmpdir(),
    `ai-advent-message-store-invariants-${Date.now()}-${Math.random()}.sqlite`,
  );
  const store = new MessageStore({ databasePath });

  assert.deepEqual(store.getInvariants(), {
    architecture: '',
    technicalDecisions: '',
    stackConstraints: '',
    businessRules: '',
  });

  const saved = store.saveInvariants({
    architecture: ['Монолит', 'REST API'],
    stackConstraints: 'Не использовать Python',
    ignored: 'not persisted',
  });

  assert.equal(saved.architecture, 'Монолит; REST API');
  assert.equal(saved.stackConstraints, 'Не использовать Python');
  assert.equal(saved.technicalDecisions, '');
  assert.equal('ignored' in saved, false);

  store.saveWorkingMemory({ goal: 'Temporary task' });
  store.clearMemory();
  assert.deepEqual(store.getInvariants(), saved);

  assert.deepEqual(store.clearInvariants(), {
    architecture: '',
    technicalDecisions: '',
    stackConstraints: '',
    businessRules: '',
  });
  assert.equal(store.getInvariants().stackConstraints, '');
  assert.deepEqual(new MessageStore({ databasePath }).getInvariants(), store.getInvariants());
});

test('MessageStore restores the lifecycle stage after a process-level break', () => {
  const databasePath = path.join(
    os.tmpdir(),
    `ai-advent-message-store-lifecycle-${Date.now()}-${Math.random()}.sqlite`,
  );
  const firstStore = new MessageStore({ databasePath });
  const initial = firstStore.getTaskLifecycle();
  firstStore.saveTaskLifecycle({
    ...initial,
    stage: 'implementation',
    artifacts: {
      ...initial.artifacts,
      plan: { content: 'Persisted plan', recordedAt: new Date().toISOString() },
    },
  });

  const restoredStore = new MessageStore({ databasePath });
  const restored = restoredStore.getTaskLifecycle();
  assert.equal(restored.stage, 'implementation');
  assert.equal(restored.artifacts.plan.content, 'Persisted plan');
});
