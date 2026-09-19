import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialTaskState, recordTaskArtifact, transitionTaskState } from './TaskStateMachine.js';

test('advances through the complete task lifecycle', () => {
  let state = createInitialTaskState('t0');
  state = transitionTaskState(state, 'advance', {}, 't1');
  assert.equal(state.stage, 'execution');
  state = transitionTaskState(state, 'advance', {}, 't2');
  assert.equal(state.stage, 'validation');
  state = transitionTaskState(state, 'advance', {}, 't3');
  assert.equal(state.stage, 'done');
  assert.equal(transitionTaskState(state, 'advance', {}, 't4').stage, 'done');
});

test('collects stage artifacts and builds the done summary', () => {
  let state = createInitialTaskState('t0');
  state = recordTaskArtifact(state, { userMessage: 'Составь план', agentAnswer: '1. Сделать экран' }, 't1');
  state = transitionTaskState(state, 'advance', {}, 't2');
  state = recordTaskArtifact(state, { userMessage: 'Выполняй', agentAnswer: 'Экран реализован' }, 't3');
  state = transitionTaskState(state, 'advance', {}, 't4');
  state = recordTaskArtifact(state, { userMessage: 'Проверь ошибки', agentAnswer: 'Ошибки исправлены' }, 't5');
  state = transitionTaskState(state, 'advance', {}, 't6');

  assert.equal(state.stage, 'done');
  assert.equal(state.artifacts.plan, '1. Сделать экран');
  assert.equal(state.artifacts.executionResults.length, 1);
  assert.equal(state.artifacts.validationResults.length, 1);
  assert.match(state.artifacts.finalSummary, /План:/);
  assert.match(state.artifacts.finalSummary, /Ошибки исправлены/);
});

test('pause and resume preserve each stage and its instructions', () => {
  let state = createInitialTaskState('t0');

  for (const stage of ['planning', 'execution', 'validation', 'done']) {
    assert.equal(state.stage, stage);
    const beforePause = state;
    const paused = transitionTaskState(state, 'pause', {}, 'pause');
    const blocked = transitionTaskState(paused, 'advance', {}, 'blocked');
    const resumed = transitionTaskState(blocked, 'resume', {}, 'resume');

    assert.deepEqual(blocked, paused);
    assert.equal(resumed.stage, beforePause.stage);
    assert.equal(resumed.currentStep, beforePause.currentStep);
    assert.equal(resumed.expectedAction, beforePause.expectedAction);
    assert.equal(resumed.isPaused, false);
    state = transitionTaskState(resumed, 'advance', {}, 'next');
  }
});
