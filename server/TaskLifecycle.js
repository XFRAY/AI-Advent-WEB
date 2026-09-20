export const TASK_STAGES = ['planning', 'implementation', 'validation', 'done'];

export const TASK_TRANSITIONS = Object.freeze({
  planning: Object.freeze({ implementation: 'approve_plan' }),
  implementation: Object.freeze({ validation: 'validation', planning: 'replan' }),
  validation: Object.freeze({ done: 'finalize', implementation: 'rework' }),
  done: Object.freeze({}),
});

const MAX_PLAN_PROMPT_LENGTH = 6000;

const INTENT_HINTS = Object.freeze({
  approve_plan: '«Утверждаю план»',
  validation: '«Проверь реализацию»',
  finalize: '«Финализируй задачу»',
  rework: '«Доработать»',
  replan: '«Пересмотреть план»',
});

const NOT_LETTER_BEFORE = '(?<!\\p{L})';
const NOT_LETTER_AFTER = '(?!\\p{L})';
const TARGET_STAGE_COMMAND = [
  'перейд(?:и|ите)',
  'переходи(?:те)?',
  'перевед(?:и|ите)(?: задачу)?',
  'установи(?:ть|те)?(?: статус)?',
  'назначь(?:те)?(?: статус)?',
  'сразу в',
  '(?:go|move|switch|jump|proceed)(?: directly| straight| immediately)? to',
  'set(?: the)?(?: task)? (?:status|stage|state)(?: directly)? to',
].join('|');
const TARGET_STAGE_GAP = '[^.!?\\n]{0,40}?';
const TARGET_STAGE_WORDS = [
  ['finalize', '(?:done|заверш(?:ено|ить|ён|ен)|финал(?:ьный|у|е)?)'],
  ['validation', '(?:validation|validating|валидаци[юяи]|проверк[уае])'],
  ['implementation', '(?:implementation|implementing|реализаци[юяи]|разработк[уаие])'],
  ['planning', '(?:planning|планировани[еяю])'],
];
const TARGET_STAGE_PATTERNS = TARGET_STAGE_WORDS.map(([intent, word]) => [
  intent,
  new RegExp(`${NOT_LETTER_BEFORE}(?:${TARGET_STAGE_COMMAND})${NOT_LETTER_AFTER}${TARGET_STAGE_GAP}${NOT_LETTER_BEFORE}${word}${NOT_LETTER_AFTER}`, 'iu'),
]);

// Only imperative forms are treated as transition commands: nouns such as
// «план реализации» or «риски реализации» are ordinary planning discussion.
const INTENT_PATTERNS = [
  ['reset', /(?<!\p{L})(?:сброс(?:ить|ь)?|начать заново|reset|start over)(?!\p{L})/iu],
  ['approve_plan', /^(?:утверждаю|одобряю|согласен|approve|approved)[.!\s]*$|(?:утверждаю|утвердить|согласен с|одобряю|approve|approved).{0,24}(?:план|plan)|(?:план|plan).{0,24}(?:утвержд[её]н|одобрен|approved)/iu],
  ['finalize', /(?:финализир|заверши задачу|готов(?:ь)? финал|finali[sz]e|final answer|mark (?:as )?done)/iu],
  ['rework', /(?:доработа(?:й|йте|ть)(?!\p{L})(?!\s+(?:мой\s+|этот\s+|данный\s+)?план)|на доработку|верни(?:сь|ть)?(?: задачу)? (?:к|на) (?:реализаци|доработк)|(?<!\p{L})rework(?!\p{L})|fix (?:the )?(?:issues|findings|problems))/iu],
  ['replan', /(?:пересмотр(?:и|ите|еть)\s+(?:мой\s+|этот\s+|утвержд[её]нный\s+)?план|(?:верни(?:сь|ть)?|вернуться)\s+(?:назад\s+)?(?:к|в)\s+планировани|измени(?:ть)?\s+(?:утвержд[её]нный\s+)?план|(?<!\p{L})replan(?!\p{L})|revise (?:the )?plan)/iu],
  ['validation', /(?:(?<!\p{L})проверь(?:те)?(?!\p{L})(?!\s+(?:мой\s+|этот\s+|данный\s+)?план)|(?:запусти|проведи|начни)(?:те)?\s+валидаци|валидируй|протестируй|запусти тест|(?<!\p{L})(?:verify|validate)(?!\p{L})|run (?:the )?tests?)/iu],
  ['implementation', /(?:реализуй(?:те)?(?!\p{L})|имплементируй|(?:начни|приступай(?:те)?)(?: к)? (?:реализаци|разработк)|начни разработку|пиши код|внеси изменени|(?<!\p{L})implement(?!\p{L})|start coding|write (?:the )?code)/iu],
  ['planning', /(?:(?:составь|подготовь)(?:те)?\s+(?:[\p{L}-]+\s+)?план|спланир|этапы работ|create (?:a )?plan|make (?:a )?plan|planning)/iu],
];

export function createInitialTaskLifecycle(now = new Date().toISOString()) {
  return {
    stage: 'planning',
    artifacts: {
      plan: null,
      implementationResults: [],
      validationResults: [],
      reworkFindings: null,
    },
    lastTransition: null,
    updatedAt: now,
  };
}

export function normalizeTaskLifecycle(value, now = new Date().toISOString()) {
  const initial = createInitialTaskLifecycle(now);
  const stage = TASK_STAGES.includes(value?.stage) ? value.stage : initial.stage;

  return {
    ...initial,
    ...value,
    stage,
    artifacts: {
      plan: value?.artifacts?.plan ?? null,
      implementationResults: Array.isArray(value?.artifacts?.implementationResults)
        ? value.artifacts.implementationResults
        : [],
      validationResults: Array.isArray(value?.artifacts?.validationResults)
        ? value.artifacts.validationResults
        : [],
      reworkFindings: typeof value?.artifacts?.reworkFindings === 'string' ? value.artifacts.reworkFindings : null,
    },
  };
}

export function detectLifecycleIntent(message) {
  const text = typeof message === 'string' ? message.trim() : '';

  for (const [intent, pattern] of TARGET_STAGE_PATTERNS) {
    if (pattern.test(text)) return intent;
  }

  for (const [intent, pattern] of INTENT_PATTERNS) {
    if (pattern.test(text)) return intent;
  }

  return 'message';
}

export function evaluateLifecycleIntent(stateValue, intent, now = new Date().toISOString()) {
  const state = normalizeTaskLifecycle(stateValue, now);

  if (intent === 'reset') {
    return transition(createInitialTaskLifecycle(now), intent, state.stage, 'Жизненный цикл сброшен. Начинаем с планирования.', now);
  }

  if (intent === 'approve_plan') {
    const permission = canTransitionTo(state, 'implementation', intent);
    if (!permission.ok) return blocked(state, intent, permission.reason);

    return transition({ ...state, stage: 'implementation' }, intent, 'planning', 'План утверждён. Можно переходить к реализации.', now);
  }

  if (intent === 'implementation') {
    if (state.stage !== 'implementation') {
      const permission = canTransitionTo(state, 'implementation', intent);
      return blocked(state, intent, permission.reason);
    }
    return allowed(state, intent);
  }

  if (intent === 'validation') {
    if (state.stage === 'implementation') {
      const permission = canTransitionTo(state, 'validation', intent);
      if (!permission.ok) return blocked(state, intent, permission.reason);
      return { ...transition({ ...state, stage: 'validation', artifacts: { ...state.artifacts, reworkFindings: null } }, intent, 'implementation', null, now), invokeModel: true };
    }
    if (state.stage !== 'validation') return blocked(state, intent, `Валидация недоступна на этапе «${stageLabel(state.stage)}».`);
    return allowed(state, intent);
  }

  if (intent === 'rework') {
    if (state.stage !== 'validation') return blocked(state, intent, 'Доработка доступна только после валидации.');
    const permission = canTransitionTo(state, 'implementation', intent);
    if (!permission.ok) return blocked(state, intent, permission.reason);

    const reworked = {
      ...state,
      stage: 'implementation',
      artifacts: {
        ...state.artifacts,
        implementationResults: [],
        validationResults: [],
        reworkFindings: state.artifacts.validationResults.at(-1)?.content ?? null,
      },
    };
    return { ...transition(reworked, intent, 'validation', null, now), invokeModel: true };
  }

  if (intent === 'replan') {
    if (state.stage === 'planning') return allowed(state, 'planning');
    if (state.stage === 'validation') return blocked(state, intent, 'Пересмотр плана доступен на этапе реализации. Сначала отправьте «Доработать», затем «Пересмотреть план».');
    if (state.stage === 'done') return blocked(state, intent, 'Задача уже завершена. Для новой задачи отправьте «сбросить».');
    const permission = canTransitionTo(state, 'planning', intent);
    if (!permission.ok) return blocked(state, intent, permission.reason);

    const replanned = {
      ...state,
      stage: 'planning',
      artifacts: {
        plan: state.artifacts.plan ? { ...state.artifacts.plan, needsRevision: true } : null,
        implementationResults: [],
        validationResults: [],
        reworkFindings: null,
      },
    };
    return transition(replanned, intent, 'implementation', 'План возвращён на пересмотр. Опишите, что нужно изменить: обновлённый план потребуется утвердить заново. Результаты реализации очищены.', now);
  }

  if (intent === 'finalize') {
    const permission = canTransitionTo(state, 'done', intent);
    if (!permission.ok) return blocked(state, intent, permission.reason);

    return transition({ ...state, stage: 'done' }, intent, 'validation', 'Валидация подтверждена. Задача завершена.', now);
  }

  if (intent === 'planning' && state.stage !== 'planning') {
    return blocked(state, intent, state.stage === 'implementation'
      ? 'План уже утверждён. Чтобы изменить его, отправьте «Пересмотреть план» (результаты реализации будут очищены), а новый план с нуля — «Сбросить».'
      : 'Новый план требует сброса текущего жизненного цикла.');
  }

  if (state.stage === 'done') return blocked(state, intent, 'Задача уже завершена. Для новой задачи отправьте «сбросить».');

  return allowed(state, intent);
}

export function recordLifecycleArtifact(stateValue, { intent, content, now = new Date().toISOString() }) {
  const state = normalizeTaskLifecycle(stateValue, now);
  const artifact = { content, recordedAt: now };

  if ((intent === 'planning' || intent === 'message' || intent === 'replan') && state.stage === 'planning') {
    return {
      ...state,
      artifacts: {
        ...state.artifacts,
        plan: { ...artifact, hasOpenQuestions: hasOpenQuestions(content) },
      },
      updatedAt: now,
    };
  }
  if ((intent === 'implementation' || intent === 'message' || intent === 'rework') && state.stage === 'implementation') {
    return { ...state, artifacts: { ...state.artifacts, implementationResults: [...state.artifacts.implementationResults, artifact] }, updatedAt: now };
  }
  if (intent === 'validation' && state.stage === 'validation') {
    return { ...state, artifacts: { ...state.artifacts, validationResults: [...state.artifacts.validationResults, artifact] }, updatedAt: now };
  }

  return state;
}

export function getAvailableLifecycleIntents(stateValue) {
  const state = normalizeTaskLifecycle(stateValue);
  if (state.stage === 'planning') return state.artifacts.plan && !state.artifacts.plan.hasOpenQuestions && !state.artifacts.plan.needsRevision ? ['planning', 'approve_plan', 'reset'] : ['planning', 'reset'];
  if (state.stage === 'implementation') return state.artifacts.implementationResults.length ? ['implementation', 'validation', 'replan', 'reset'] : ['implementation', 'replan', 'reset'];
  if (state.stage === 'validation') return state.artifacts.validationResults.length ? ['validation', 'finalize', 'rework', 'reset'] : ['validation', 'reset'];
  return ['reset'];
}

export function canTransitionTo(stateValue, targetStage, intent = null) {
  const state = normalizeTaskLifecycle(stateValue);

  if (!TASK_STAGES.includes(targetStage)) {
    return { ok: false, reason: `Неизвестное состояние «${targetStage}».` };
  }

  if (intent === 'reset') return { ok: targetStage === 'planning', reason: targetStage === 'planning' ? null : 'Сброс всегда переводит задачу в planning.' };

  const requiredIntent = TASK_TRANSITIONS[state.stage]?.[targetStage];
  if (!requiredIntent) {
    return { ok: false, reason: transitionBlockedReason(state.stage, targetStage) };
  }
  if (intent !== requiredIntent) {
    if (state.stage === 'planning' && targetStage === 'implementation') {
      return { ok: false, reason: 'Нельзя начинать реализацию до утверждения сохранённого плана.' };
    }
    return { ok: false, reason: `Переход ${state.stage} → ${targetStage} разрешён только командой ${INTENT_HINTS[requiredIntent] || `«${requiredIntent}»`}.` };
  }
  if (intent === 'rework' && state.artifacts.validationResults.length === 0) {
    return { ok: false, reason: 'Доработка возможна только после результата валидации.' };
  }
  if (targetStage === 'implementation' && !state.artifacts.plan) {
    return { ok: false, reason: 'Сначала нужно составить и сохранить план.' };
  }
  if (targetStage === 'implementation' && state.artifacts.plan.needsRevision) {
    return { ok: false, reason: 'План возвращён на пересмотр: опишите изменения, получите обновлённый план и утвердите его заново.' };
  }
  if (targetStage === 'implementation' && state.artifacts.plan.hasOpenQuestions) {
    return { ok: false, reason: 'Сначала нужно закрыть открытые вопросы по требованиям и обновить план.' };
  }
  if (targetStage === 'validation' && state.artifacts.implementationResults.length === 0) {
    return {
      ok: false,
      reason: state.lastTransition?.intent === 'rework'
        ? 'После доработки результаты реализации и проверки очищены. Сначала отправьте сообщение с исправлениями, затем повторите проверку.'
        : 'Нельзя начинать валидацию без результата реализации.',
    };
  }
  if (targetStage === 'done' && state.artifacts.validationResults.length === 0) {
    return { ok: false, reason: 'Нельзя завершить задачу без результата валидации.' };
  }

  return { ok: true, reason: null };
}

export function getAvailableLifecycleTransitions(stateValue) {
  const state = normalizeTaskLifecycle(stateValue);

  const transitions = Object.entries(TASK_TRANSITIONS[state.stage] || {})
    .filter(([target, intent]) => canTransitionTo(state, target, intent).ok)
    .map(([to, transitionIntent]) => ({ from: state.stage, to, intent: transitionIntent }));

  if (state.stage !== 'planning') transitions.push({ from: state.stage, to: 'planning', intent: 'reset' });
  return transitions;
}

export function serializeTaskLifecycle(stateValue, blockedReason = null) {
  const state = normalizeTaskLifecycle(stateValue);
  return {
    ...state,
    availableIntents: getAvailableLifecycleIntents(state),
    allowedTransitions: getAvailableLifecycleTransitions(state),
    blockedReason,
  };
}

export function buildTaskLifecycleInput(stateValue) {
  const state = serializeTaskLifecycle(stateValue);
  const stageInstruction = getStageInstruction(state.stage);
  return {
    role: 'system',
    content: [
      'Controlled task lifecycle (mandatory).',
      `Current stage: ${state.stage}.`,
      `Allowed intents: ${state.availableIntents.join(', ')}.`,
      `Plan saved: ${Boolean(state.artifacts.plan)}.`,
      `Implementation results: ${state.artifacts.implementationResults.length}.`,
      `Validation results: ${state.artifacts.validationResults.length}.`,
      ...describePlan(state),
      ...describeRework(state),
      'Work only within the current stage. Do not claim that a later stage is complete.',
      stageInstruction,
    ].join('\n'),
  };
}

function describeRework(state) {
  const findings = state.stage === 'implementation' ? state.artifacts.reworkFindings : null;
  if (!findings) return [];

  const content = findings.length > MAX_PLAN_PROMPT_LENGTH ? `${findings.slice(0, MAX_PLAN_PROMPT_LENGTH)}…` : findings;
  return [
    'REWORK REQUESTED: fix the problems reported by the latest validation, plus any changes the user lists in the current request, staying within the approved plan.',
    'If the validation found no problems, apply only what the user asks. Latest validation result:',
    content,
  ];
}

function describePlan(state) {
  const plan = state.artifacts.plan;
  if (!plan?.content) return [];

  const header = state.stage !== 'planning'
    ? 'Approved plan (source of truth):'
    : plan.needsRevision
      ? 'Plan returned for revision. Apply the changes the user asks for and output the full updated plan. Previous plan:'
      : 'Current plan draft:';
  const content = plan.content.length > MAX_PLAN_PROMPT_LENGTH
    ? `${plan.content.slice(0, MAX_PLAN_PROMPT_LENGTH)}…`
    : plan.content;

  return [header, content];
}

function allowed(state, intent) {
  return { ok: true, state, intent, invokeModel: true, response: null };
}

function transition(state, intent, from, response, now) {
  const next = {
    ...state,
    lastTransition: { intent, from, to: state.stage, at: now },
    updatedAt: now,
  };
  return { ok: true, state: next, intent, invokeModel: false, response };
}

function blocked(state, intent, reason) {
  return { ok: false, state, intent, invokeModel: false, response: null, reason };
}

function stageLabel(stage) {
  return ({ planning: 'планирование', implementation: 'реализация', validation: 'валидация', done: 'завершено' })[stage] || stage;
}

function getStageInstruction(stage) {
  if (stage === 'planning') {
    return [
      'PLANNING-ONLY RULE: collect and clarify requirements, constraints, acceptance criteria, open questions, and an implementation plan.',
      'Do not provide source code, patches, completed implementation, validation results, or claim that any implementation work was performed.',
      'If the user asks to implement, code, validate, or finish, explain that the plan must be produced and explicitly approved first.',
      'Always end the plan with a section "Открытые вопросы:" that lists unresolved questions, or "нет" when there are none.',
    ].join(' ');
  }
  if (stage === 'implementation') {
    return [
      'IMPLEMENTATION RULE: implement only the approved plan above and do not claim validation or completion.',
      'If the user asks to change, replace or extend anything the plan specifies (libraries, storage, architecture, scope, behavior), do not carry it out:',
      'explain that the plan is approved and that they must send «Пересмотреть план» to return to planning.',
      'Filling in details that the plan leaves open is allowed.',
    ].join(' ');
  }
  if (stage === 'validation') {
    return 'VALIDATION RULE: inspect and validate the implementation against the approved plan. Do not claim completion until validation evidence is recorded.';
  }
  return 'DONE RULE: summarize the completed, validated result. New work requires reset.';
}

function transitionBlockedReason(from, to) {
  if (from === 'planning' && to === 'implementation') return 'Нельзя начинать реализацию до утверждения сохранённого плана.';
  if (to === 'validation') return 'Нельзя переходить к валидации до завершения реализации.';
  if (to === 'done' && from === 'implementation') return 'Задача ещё не прошла валидацию. Сначала выполните проверку реализации, затем завершайте.';
  if (to === 'done') return 'Нельзя завершить задачу до этапа валидации.';
  if (from === 'done') return 'Задача уже завершена. Для новой задачи отправьте «сбросить».';
  return `Переход ${from} → ${to} не разрешён.`;
}

function hasOpenQuestions(content) {
  const text = typeof content === 'string' ? content : '';
  const sections = [...text.matchAll(/(?:открытые|нереш[её]нные|open)\s+(?:вопросы|questions)\s*[:\-–—]?[ \t]*([\s\S]*?)(?=(?:открытые|нереш[её]нные|open)\s+(?:вопросы|questions)|$)/giu)];
  const section = sections.at(-1);

  if (section) {
    const body = section[1].trim();
    return body !== '' && !/^(?:нет|отсутствуют|не осталось|none|no|n\/a|[-–—.]+)[.\s]*$/iu.test(body);
  }

  return /\?|нужно уточнить|уточните, пожалуйста|please clarify/iu.test(text);
}
