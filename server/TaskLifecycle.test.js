import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TASK_STAGES,
  TASK_TRANSITIONS,
  canTransitionTo,
  buildTaskLifecycleInput,
  createInitialTaskLifecycle,
  detectLifecycleIntent,
  evaluateLifecycleIntent,
  getAvailableLifecycleIntents,
  recordLifecycleArtifact,
} from './TaskLifecycle.js';

test('lifecycle follows planning, implementation, validation, and done in order', () => {
  let state = createInitialTaskLifecycle();
  state = recordLifecycleArtifact(state, { intent: 'planning', content: 'Plan' });
  let result = evaluateLifecycleIntent(state, 'approve_plan');
  assert.equal(result.ok, true);
  assert.equal(result.state.stage, 'implementation');

  state = recordLifecycleArtifact(result.state, { intent: 'implementation', content: 'Code changed' });
  result = evaluateLifecycleIntent(state, 'validation');
  assert.equal(result.state.stage, 'validation');
  state = recordLifecycleArtifact(result.state, { intent: 'validation', content: 'Tests pass' });
  result = evaluateLifecycleIntent(state, 'finalize');
  assert.equal(result.ok, true);
  assert.equal(result.state.stage, 'done');
});

test('implementation is blocked until a saved plan is approved', () => {
  const result = evaluateLifecycleIntent(createInitialTaskLifecycle(), 'implementation');
  assert.equal(result.ok, false);
  assert.match(result.reason, /утверждения/);
});

test('finalization is blocked without validation result', () => {
  const state = { ...createInitialTaskLifecycle(), stage: 'validation' };
  const result = evaluateLifecycleIntent(state, 'finalize');
  assert.equal(result.ok, false);
  assert.match(result.reason, /результата валидации/);
});

test('invalid transition leaves state unchanged', () => {
  const state = createInitialTaskLifecycle();
  const result = evaluateLifecycleIntent(state, 'finalize');
  assert.equal(result.ok, false);
  assert.deepEqual(result.state, state);
});

test('completed task can only be reset', () => {
  const state = { ...createInitialTaskLifecycle(), stage: 'done' };
  assert.equal(evaluateLifecycleIntent(state, 'message').ok, false);
  assert.equal(evaluateLifecycleIntent(state, 'reset').state.stage, 'planning');
});

test('detects Russian and English lifecycle intents', () => {
  assert.equal(detectLifecycleIntent('Утверждаю план'), 'approve_plan');
  assert.equal(detectLifecycleIntent('утверждаю'), 'approve_plan');
  assert.equal(detectLifecycleIntent('Согласен'), 'approve_plan');
  assert.equal(detectLifecycleIntent('Начни реализацию'), 'implementation');
  assert.equal(detectLifecycleIntent('Проверь результат'), 'validation');
  assert.equal(detectLifecycleIntent('Финализируй задачу'), 'finalize');
  assert.equal(detectLifecycleIntent('Create a plan'), 'planning');
});

test('detects explicit target-state commands without treating state discussion as a transition', () => {
  assert.equal(detectLifecycleIntent('Переходи сразу в done'), 'finalize');
  assert.equal(detectLifecycleIntent('Переведи задачу в validation'), 'validation');
  assert.equal(detectLifecycleIntent('Установи статус implementation'), 'implementation');
  assert.equal(detectLifecycleIntent('Move directly to done'), 'finalize');
  assert.equal(detectLifecycleIntent('Объясни, что означает состояние done'), 'message');
});

test('explicit target-state commands cannot skip lifecycle stages', () => {
  const planning = createInitialTaskLifecycle();
  const validationJump = evaluateLifecycleIntent(planning, detectLifecycleIntent('Перейди в validation'));
  const doneJump = evaluateLifecycleIntent(planning, detectLifecycleIntent('Переходи сразу в done'));

  assert.equal(validationJump.ok, false);
  assert.equal(validationJump.state.stage, 'planning');
  assert.equal(doneJump.ok, false);
  assert.equal(doneJump.state.stage, 'planning');
});

test('transition matrix explicitly allows and rejects every state pair', () => {
  const completeArtifacts = {
    plan: { content: 'Plan', recordedAt: '2026-01-01T00:00:00.000Z' },
    implementationResults: [{ content: 'Built', recordedAt: '2026-01-01T00:00:00.000Z' }],
    validationResults: [{ content: 'Passed', recordedAt: '2026-01-01T00:00:00.000Z' }],
  };

  for (const from of TASK_STAGES) {
    const state = { ...createInitialTaskLifecycle(), stage: from, artifacts: completeArtifacts };

    for (const to of TASK_STAGES) {
      const intent = TASK_TRANSITIONS[from]?.[to] || 'direct_transition';
      const result = canTransitionTo(state, to, intent);
      assert.equal(result.ok, Boolean(TASK_TRANSITIONS[from]?.[to]), `${from} -> ${to}`);
    }
  }
});

test('transition guards require the artifact produced by the previous stage', () => {
  const planning = createInitialTaskLifecycle();
  assert.equal(canTransitionTo(planning, 'implementation', 'approve_plan').ok, false);

  const implementation = { ...planning, stage: 'implementation' };
  assert.equal(canTransitionTo(implementation, 'validation', 'validation').ok, false);

  const validation = { ...planning, stage: 'validation' };
  assert.equal(canTransitionTo(validation, 'done', 'finalize').ok, false);
});

test('planning context allows requirements and plans but forbids implementation', () => {
  const input = buildTaskLifecycleInput(createInitialTaskLifecycle());
  assert.match(input.content, /PLANNING-ONLY RULE/);
  assert.match(input.content, /requirements/);
  assert.match(input.content, /Do not provide source code/);
  assert.match(input.content, /explicitly approved first/);
});

test('plan approval becomes available only after open questions are closed', () => {
  let state = recordLifecycleArtifact(createInitialTaskLifecycle(), {
    intent: 'planning',
    content: 'Какой лимит вариантов нужен?',
  });
  assert.equal(state.artifacts.plan.hasOpenQuestions, true);
  assert.equal(getAvailableLifecycleIntents(state).includes('approve_plan'), false);
  assert.equal(canTransitionTo(state, 'implementation', 'approve_plan').ok, false);

  state = recordLifecycleArtifact(state, {
    intent: 'message',
    content: 'Требования уточнены. Итоговый план сформирован и готов к утверждению.',
  });
  assert.equal(state.artifacts.plan.hasOpenQuestions, false);
  assert.equal(getAvailableLifecycleIntents(state).includes('approve_plan'), true);
});

function stateAt(stage, artifacts = {}) {
  return {
    ...createInitialTaskLifecycle(),
    stage,
    artifacts: {
      plan: { content: 'Plan', recordedAt: '2026-01-01T00:00:00.000Z', hasOpenQuestions: false },
      implementationResults: [{ content: 'Built', recordedAt: '2026-01-01T00:00:00.000Z' }],
      validationResults: [{ content: 'Found issues', recordedAt: '2026-01-01T00:00:00.000Z' }],
      ...artifacts,
    },
  };
}

test('rework returns from validation to implementation and requires fresh validation', () => {
  const result = evaluateLifecycleIntent(stateAt('validation'), 'rework');

  assert.equal(result.ok, true);
  assert.equal(result.invokeModel, true);
  assert.equal(result.state.stage, 'implementation');
  assert.equal(result.state.lastTransition.from, 'validation');
  assert.equal(result.state.artifacts.reworkFindings, 'Found issues');
  assert.match(buildTaskLifecycleInput(result.state).content, /REWORK REQUESTED[\s\S]*Found issues/);
  assert.equal(result.state.artifacts.implementationResults.length, 0);
  assert.equal(result.state.artifacts.validationResults.length, 0);
  assert.ok(result.state.artifacts.plan);
  const revalidate = evaluateLifecycleIntent(result.state, 'validation');
  assert.equal(revalidate.ok, false);
  assert.match(revalidate.reason, /После доработки.*сообщение с исправлениями/);
  assert.match(evaluateLifecycleIntent(result.state, 'finalize').reason, /ещё не прошла валидацию/);

  let state = recordLifecycleArtifact(result.state, { intent: 'rework', content: 'Fixed' });
  assert.equal(state.artifacts.implementationResults.length, 1);
  state = evaluateLifecycleIntent(state, 'validation').state;
  assert.equal(state.artifacts.reworkFindings, null);
  assert.equal(evaluateLifecycleIntent(state, 'finalize').ok, false);
  assert.doesNotMatch(buildTaskLifecycleInput(state).content, /REWORK REQUESTED/);
});

test('rework is unavailable outside validation or without a validation result', () => {
  for (const stage of ['planning', 'implementation', 'done']) {
    const result = evaluateLifecycleIntent(stateAt(stage), 'rework');
    assert.equal(result.ok, false, stage);
    assert.equal(result.state.stage, stage);
  }

  const noResult = evaluateLifecycleIntent(stateAt('validation', { validationResults: [] }), 'rework');
  assert.equal(noResult.ok, false);
  assert.match(noResult.reason, /после результата валидации/);
  assert.equal(getAvailableLifecycleIntents(stateAt('validation')).includes('rework'), true);
  assert.equal(getAvailableLifecycleIntents(stateAt('validation', { validationResults: [] })).includes('rework'), false);
});

test('jumping back to implementation from validation points to the rework command', () => {
  const result = evaluateLifecycleIntent(stateAt('validation'), detectLifecycleIntent('Перейди в implementation'));

  assert.equal(result.ok, false);
  assert.match(result.reason, /«Доработать»/);
});

test('detects rework without capturing plan edits', () => {
  assert.equal(detectLifecycleIntent('Доработать'), 'rework');
  assert.equal(detectLifecycleIntent('Верни на доработку'), 'rework');
  assert.equal(detectLifecycleIntent('Доработай план'), 'message');
});

test('planning discussion that mentions later stages is not a transition attempt', () => {
  for (const text of [
    'Составь план реализации фичи',
    'Какие риски у реализации?',
    'Проверь план на полноту',
    'Please remove ambiguity from the plan',
    'Set up the requirements list',
    'Расскажи, как перейти к реализации',
  ]) {
    const intent = detectLifecycleIntent(text);
    assert.equal(evaluateLifecycleIntent(createInitialTaskLifecycle(), intent).ok, true, text);
  }
});

test('imperative commands for later stages are still blocked in planning', () => {
  for (const text of ['Напиши код', 'Реализуй это', 'Начни реализацию', 'Перейди к проверке', 'Move directly to done', 'Set the task status directly to done']) {
    const result = evaluateLifecycleIntent(createInitialTaskLifecycle(), detectLifecycleIntent(text));
    assert.equal(result.ok, false, text);
    assert.equal(result.state.stage, 'planning', text);
  }
});

test('reset command tolerates trailing punctuation', () => {
  assert.equal(detectLifecycleIntent('Сбросить.'), 'reset');
  assert.equal(detectLifecycleIntent('reset!'), 'reset');
});

test('open questions are read from the dedicated plan section', () => {
  const plan = (content) => recordLifecycleArtifact(createInitialTaskLifecycle(), { intent: 'planning', content }).artifacts.plan;

  assert.equal(plan('1. Шаги.\n\nОткрытые вопросы: нет.').hasOpenQuestions, false);
  assert.equal(plan('1. Шаги.\n\nОткрытые вопросы:\n1. Какой лимит?').hasOpenQuestions, true);
  assert.equal(plan('Какой лимит нужен?').hasOpenQuestions, true);
  assert.equal(plan('План готов.').hasOpenQuestions, false);
});

test('planning prompt asks for an open questions section', () => {
  assert.match(buildTaskLifecycleInput(createInitialTaskLifecycle()).content, /Открытые вопросы:/);
});

test('plain messages in implementation are recorded as implementation results', () => {
  const state = recordLifecycleArtifact(stateAt('implementation', { implementationResults: [] }), { intent: 'message', content: 'Добавил эндпоинт' });

  assert.equal(state.artifacts.implementationResults.length, 1);
  assert.equal(evaluateLifecycleIntent(state, 'validation').ok, true);
});

test('replan returns an approved plan to planning and requires approving the updated plan again', () => {
  const result = evaluateLifecycleIntent(stateAt('implementation'), 'replan');

  assert.equal(result.ok, true);
  assert.equal(result.invokeModel, false);
  assert.equal(result.state.stage, 'planning');
  assert.equal(result.state.lastTransition.from, 'implementation');
  assert.equal(result.state.artifacts.plan.content, 'Plan');
  assert.equal(result.state.artifacts.plan.needsRevision, true);
  assert.equal(result.state.artifacts.implementationResults.length, 0);
  assert.equal(result.state.artifacts.validationResults.length, 0);

  const approve = evaluateLifecycleIntent(result.state, 'approve_plan');
  assert.equal(approve.ok, false);
  assert.match(approve.reason, /возвращён на пересмотр/);
  assert.equal(getAvailableLifecycleIntents(result.state).includes('approve_plan'), false);

  const revised = recordLifecycleArtifact(result.state, { intent: 'message', content: 'Обновлённый план. Открытые вопросы: нет.' });
  assert.equal(revised.artifacts.plan.needsRevision, undefined);
  assert.equal(evaluateLifecycleIntent(revised, 'approve_plan').ok, true);
});

test('replan is offered only during implementation', () => {
  assert.equal(getAvailableLifecycleIntents(stateAt('implementation')).includes('replan'), true);
  for (const stage of ['validation', 'done']) {
    const result = evaluateLifecycleIntent(stateAt(stage), 'replan');
    assert.equal(result.ok, false, stage);
    assert.equal(result.state.stage, stage);
    assert.equal(getAvailableLifecycleIntents(stateAt(stage)).includes('replan'), false, stage);
  }
  assert.match(evaluateLifecycleIntent(stateAt('validation'), 'replan').reason, /«Доработать»/);
});

test('revising the plan during planning is a normal planning message that updates the plan', () => {
  const state = createInitialTaskLifecycle();
  const result = evaluateLifecycleIntent(state, detectLifecycleIntent('Пересмотри план: храни данные в файле'));

  assert.equal(result.ok, true);
  assert.equal(result.invokeModel, true);
  assert.equal(recordLifecycleArtifact(state, { intent: 'replan', content: 'Новый план' }).artifacts.plan.content, 'Новый план');
});

test('detects replan commands and points to them when a new plan is requested after approval', () => {
  assert.equal(detectLifecycleIntent('Пересмотреть план'), 'replan');
  assert.equal(detectLifecycleIntent('Верни к планированию'), 'replan');
  assert.equal(detectLifecycleIntent('Revise the plan'), 'replan');

  const result = evaluateLifecycleIntent(stateAt('implementation'), detectLifecycleIntent('Составь новый план'));
  assert.equal(result.ok, false);
  assert.match(result.reason, /«Пересмотреть план»/);
});

test('approved plan text and change-control rule are passed to the model after approval', () => {
  const state = stateAt('implementation', { plan: { content: 'PLAN-BODY: хранить в памяти', hasOpenQuestions: false } });
  const implementation = buildTaskLifecycleInput(state).content;

  assert.match(implementation, /Approved plan \(source of truth\):\nPLAN-BODY: хранить в памяти/);
  assert.match(implementation, /«Пересмотреть план»/);
  assert.match(implementation, /do not carry it out/);
  assert.match(buildTaskLifecycleInput({ ...state, stage: 'validation' }).content, /Approved plan \(source of truth\):\nPLAN-BODY/);
  assert.match(buildTaskLifecycleInput({ ...state, stage: 'planning' }).content, /Current plan draft:\nPLAN-BODY/);
  assert.match(
    buildTaskLifecycleInput({ ...state, stage: 'planning', artifacts: { ...state.artifacts, plan: { ...state.artifacts.plan, needsRevision: true } } }).content,
    /Plan returned for revision/,
  );
  assert.doesNotMatch(buildTaskLifecycleInput(createInitialTaskLifecycle()).content, /plan \(source of truth\)/);
});
