const INVARIANT_FIELDS = [
  ['architecture', 'Architecture'],
  ['technicalDecisions', 'Technical decisions'],
  ['stackConstraints', 'Stack constraints'],
  ['businessRules', 'Business rules'],
];

const REQUEST_MARKERS = [
  'использ',
  'добав',
  'перейти',
  'перепиш',
  'замени',
  'внедри',
  'use ',
  'add ',
  'switch ',
  'replace ',
  'rewrite ',
  'implement ',
];

const NEGATIVE_RULE_PATTERNS = [
  /^(?:не\s+использовать|запрещено|нельзя)\s*[:\-]?\s*(.+)$/iu,
  /^(?:do\s+not\s+use|must\s+not\s+use|forbidden)\s*[:\-]?\s*(.+)$/iu,
];
const ONLY_RULE_PATTERNS = [
  /^(?:использовать\s+только|только)\s*[:\-]?\s*(.+)$/iu,
  /^(?:use\s+only|only)\s*[:\-]?\s*(.+)$/iu,
];
const EXCLUSIVE_TERM_GROUPS = [
  ['монолит', 'микросервис'],
  ['monolith', 'microservice'],
  ['rest', 'graphql', 'grpc'],
  ['react', 'vue', 'angular', 'svelte'],
];

export function getInvariantRules(invariants = {}) {
  return INVARIANT_FIELDS.flatMap(([field, label]) =>
    splitRules(invariants[field]).map((text) => ({ field, label, text })),
  );
}

export function getInvariantStats(invariants) {
  const rules = getInvariantRules(invariants);

  return {
    activeCount: rules.length,
    fieldsWithRules: new Set(rules.map((rule) => rule.field)).size,
  };
}

export function buildInvariantsInput(invariants) {
  const rules = getInvariantRules(invariants);

  if (rules.length === 0) return null;

  const sections = INVARIANT_FIELDS.map(([field, label]) => {
    const fieldRules = rules.filter((rule) => rule.field === field);
    if (fieldRules.length === 0) return null;
    return `${label}:\n${fieldRules.map((rule) => `- ${rule.text}`).join('\n')}`;
  }).filter(Boolean);

  return {
    role: 'system',
    content: [
      'Mandatory invariants (highest priority after the base system instruction).',
      'You must explicitly account for these rules in your reasoning and must not propose solutions that violate them.',
      'If a request conflicts with a rule, refuse that part and explain which invariant would be violated.',
      ...sections,
    ].join('\n\n'),
  };
}

export function findInvariantConflict(message, invariants) {
  const normalizedMessage = normalizeForMatch(message);

  if (!normalizedMessage || !REQUEST_MARKERS.some((marker) => normalizedMessage.includes(marker))) {
    return null;
  }

  for (const rule of getInvariantRules(invariants)) {
    const negativeTarget = extractTarget(rule.text, NEGATIVE_RULE_PATTERNS);
    if (negativeTarget && includesTarget(normalizedMessage, negativeTarget)) {
      return rule;
    }

    const onlyTarget = extractTarget(rule.text, ONLY_RULE_PATTERNS);
    if (onlyTarget && requestsAlternative(normalizedMessage, onlyTarget)) {
      return rule;
    }

    if (requestsExclusiveAlternative(normalizedMessage, normalizeForMatch(rule.text))) {
      return rule;
    }
  }

  return null;
}

function requestsExclusiveAlternative(message, rule) {
  return EXCLUSIVE_TERM_GROUPS.some((group) => {
    const selected = group.find((term) => rule.includes(term));
    if (!selected) return false;

    return group.some((term) => term !== selected && message.includes(term));
  });
}

function splitRules(value) {
  if (typeof value !== 'string') return [];

  return value
    .split(/\r?\n|;/u)
    .map((rule) => rule.replace(/^\s*[-*•]\s*/u, '').trim())
    .filter(Boolean);
}

function extractTarget(rule, patterns) {
  for (const pattern of patterns) {
    const match = rule.match(pattern);
    if (match) return normalizeForMatch(match[1]);
  }
  return '';
}

function includesTarget(message, target) {
  return target.length >= 2 && message.includes(target);
}

function requestsAlternative(message, allowedTarget) {
  const request = REQUEST_MARKERS.find((marker) => message.includes(marker));
  if (!request) return false;

  const requestedPart = message.slice(message.indexOf(request) + request.length).trim();
  return requestedPart.length >= 2 && !requestedPart.includes(allowedTarget);
}

function normalizeForMatch(value) {
  return String(value || '')
    .toLocaleLowerCase('ru-RU')
    .replace(/["'`«»]/gu, '')
    .replace(/[.,!?()[\]{}]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

export { INVARIANT_FIELDS };
