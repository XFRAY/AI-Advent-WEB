export const TASK_STAGES = ['planning', 'execution', 'validation', 'done'];

const STAGE_DEFAULTS = {
  planning: {
    currentStep: 'Сформулировать задачу',
    expectedAction: 'Опишите цель задачи',
  },
  execution: {
    currentStep: 'Выполнить задачу',
    expectedAction: 'Выполните следующий шаг плана',
  },
  validation: {
    currentStep: 'Проверить результат',
    expectedAction: 'Подтвердите, что результат соответствует цели',
  },
  done: {
    currentStep: 'Задача завершена',
    expectedAction: 'Начните новую задачу или сбросьте состояние',
  },
};

const DEFAULT_ARTIFACTS = {
  plan: '',
  executionResults: [],
  validationResults: [],
  finalSummary: '',
};

export class TaskStateError extends Error {}

export function createInitialTaskState(now = new Date().toISOString()) {
  return {
    stage: 'planning',
    ...STAGE_DEFAULTS.planning,
    isPaused: false,
    lastEvent: 'start',
    updatedAt: now,
    artifacts: { ...DEFAULT_ARTIFACTS },
  };
}

export function transitionTaskState(state, event, payload = {}, now = new Date().toISOString()) {
  const current = normalizeTaskState(state);

  if (!['start', 'advance', 'pause', 'resume', 'complete', 'reset'].includes(event)) {
    throw new TaskStateError(`Unsupported task event: ${event}`);
  }

  if (event === 'reset' || event === 'start') {
    return applyPayload(createInitialTaskState(now), payload, event, now);
  }

  if (current.isPaused && event !== 'resume') {
    return current;
  }

  if (event === 'pause') {
    return { ...current, isPaused: true, lastEvent: event, updatedAt: now };
  }

  if (event === 'resume') {
    return { ...current, isPaused: false, lastEvent: event, updatedAt: now };
  }

  const stage = event === 'complete'
    ? 'done'
    : TASK_STAGES[Math.min(TASK_STAGES.indexOf(current.stage) + 1, TASK_STAGES.length - 1)];

  const next = applyPayload(
    { ...current, stage, ...STAGE_DEFAULTS[stage], lastEvent: event, updatedAt: now },
    payload,
    event,
    now,
  );

  return stage === 'done'
    ? { ...next, artifacts: { ...next.artifacts, finalSummary: buildFinalSummary(next.artifacts) } }
    : next;
}

export function normalizeTaskState(state) {
  const fallback = createInitialTaskState();
  const stage = TASK_STAGES.includes(state?.stage) ? state.stage : fallback.stage;

  return {
    stage,
    currentStep: normalizeText(state?.currentStep, STAGE_DEFAULTS[stage].currentStep),
    expectedAction: normalizeText(state?.expectedAction, STAGE_DEFAULTS[stage].expectedAction),
    isPaused: Boolean(state?.isPaused),
    lastEvent: normalizeText(state?.lastEvent, fallback.lastEvent),
    updatedAt: normalizeText(state?.updatedAt, fallback.updatedAt),
    artifacts: normalizeArtifacts(state?.artifacts),
  };
}

export function recordTaskArtifact(state, { userMessage, agentAnswer }, now = new Date().toISOString()) {
  const current = normalizeTaskState(state);
  const entry = {
    request: normalizeText(userMessage, ''),
    result: normalizeText(agentAnswer, ''),
    recordedAt: now,
  };

  if (!entry.result || current.stage === 'done') return current;

  if (current.stage === 'planning') {
    return {
      ...current,
      updatedAt: now,
      artifacts: { ...current.artifacts, plan: entry.result },
    };
  }

  const collection = current.stage === 'execution' ? 'executionResults' : 'validationResults';
  return {
    ...current,
    updatedAt: now,
    artifacts: {
      ...current.artifacts,
      [collection]: [...current.artifacts[collection], entry],
    },
  };
}

export function buildTaskStateInput(state) {
  const taskState = normalizeTaskState(state);

  return {
    role: 'system',
    content: [
      'Formal task state. Continue from this exact state without repeating earlier explanations.',
      `Stage: ${taskState.stage}`,
      `Current step: ${taskState.currentStep}`,
      `Expected action: ${taskState.expectedAction}`,
      `Paused: ${taskState.isPaused}`,
      `Task artifacts JSON: ${JSON.stringify(taskState.artifacts)}`,
    ].join('\n'),
  };
}

function applyPayload(state, payload, event, now) {
  return {
    ...state,
    currentStep: normalizeText(payload?.currentStep, state.currentStep),
    expectedAction: normalizeText(payload?.expectedAction, state.expectedAction),
    lastEvent: event,
    updatedAt: now,
  };
}

function normalizeText(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizeArtifacts(artifacts) {
  return {
    plan: normalizeText(artifacts?.plan, ''),
    executionResults: normalizeEntries(artifacts?.executionResults),
    validationResults: normalizeEntries(artifacts?.validationResults),
    finalSummary: normalizeText(artifacts?.finalSummary, ''),
  };
}

function normalizeEntries(entries) {
  if (!Array.isArray(entries)) return [];

  return entries
    .map((entry) => ({
      request: normalizeText(entry?.request, ''),
      result: normalizeText(entry?.result, ''),
      recordedAt: normalizeText(entry?.recordedAt, ''),
    }))
    .filter((entry) => entry.result);
}

function buildFinalSummary(artifacts) {
  const sections = [];
  if (artifacts.plan) sections.push(`План:\n${artifacts.plan}`);
  if (artifacts.executionResults.length) {
    sections.push(`Выполнение:\n${artifacts.executionResults.map(formatEntry).join('\n\n')}`);
  }
  if (artifacts.validationResults.length) {
    sections.push(`Проверка и решённые вопросы:\n${artifacts.validationResults.map(formatEntry).join('\n\n')}`);
  }
  return sections.join('\n\n') || 'Задача завершена без сохранённых артефактов.';
}

function formatEntry(entry, index) {
  return `${index + 1}. Запрос: ${entry.request || 'Не указан'}\nРезультат: ${entry.result}`;
}
