export const DEFAULT_SHORT_TERM_LIMIT = 8;
const MIN_SHORT_TERM_LIMIT = 2;
const MAX_SHORT_TERM_LIMIT = 30;

export const DEFAULT_WORKING_MEMORY = {
  goal: '',
  taskData: '',
  constraints: '',
  openQuestions: '',
  nextSteps: '',
};

export const DEFAULT_LONG_TERM_MEMORY = {
  profile: '',
  preferences: '',
  decisions: '',
  knowledge: '',
};

const MEMORY_EXTRACTION_SYSTEM_MESSAGE = {
  role: 'system',
  content: [
    'Update an explicit memory model for an assistant. Split information into working memory and long-term memory.',
    '',
    'Working memory is the structured state of the current chat/task only:',
    '- goal: the current task goal.',
    '- taskData: concrete data, requirements, or implementation details for this task.',
    '- constraints: current task constraints.',
    '- openQuestions: unresolved questions for this task.',
    '- nextSteps: likely next actions for this task.',
    '',
    'Long-term memory is information that should survive a new chat/session:',
    '- profile: stable identity/context facts about the user or project owner, such as role, student status, language, recurring workflow, or project context.',
    '- preferences: durable likes, interests, priorities, style, language, UI, coding, or collaboration preferences. If the user says they like books, prefer Kotlin/Android, want a mobile app, value career usefulness, or repeatedly favor a topic/technology, record it here.',
    '- decisions: durable decisions or agreements that should not be re-decided in a new chat, including project architecture, API/schema, UI layout, and naming choices.',
    '- knowledge: reusable facts, conclusions, or lessons learned from the user message or assistant answer that may help future tasks. Record generalizable guidance, platform facts, implementation lessons, or research findings; do not store one-off wording.',
    '',
    'Important rules:',
    '- Short-term dialogue is stored elsewhere; do not copy raw transcript into memory.',
    '- If the user says something like "делаем 11 день", "делаем UI в 3 колонки", or approves an implementation direction, preserve the durable project decision in longTermMemory.decisions when it should carry into a future chat about this project.',
    '- If the user reveals stable context like preferred language, course/project format, or recurring way of working, preserve it in longTermMemory.profile or preferences.',
    '- If the user reveals interests or likes, put them in longTermMemory.preferences even when they are also relevant to profile.',
    '- If the assistant answer contains reusable advice or facts that would be useful in a future similar task, distill them into longTermMemory.knowledge.',
    '- Prefer filling the most specific long-term field when there is clear evidence; do not leave preferences or knowledge empty just because profile or decisions were also updated.',
    '- Keep existing values unless the new exchange clearly updates, refines, or contradicts them.',
    '- Do not invent facts. Return only valid JSON with keys workingMemory and longTermMemory.',
  ].join('\n'),
};

export class MemoryLayers {
  constructor({ client = null, model } = {}) {
    this.client = client;
    this.model = model;
  }

  normalizeSettings(settings = {}) {
    return {
      shortTermLimit: clampInteger(
        settings.shortTermLimit,
        DEFAULT_SHORT_TERM_LIMIT,
        MIN_SHORT_TERM_LIMIT,
        MAX_SHORT_TERM_LIMIT,
      ),
    };
  }

  previewContext({
    shortTermMessages = [],
    workingMemory = DEFAULT_WORKING_MEMORY,
    longTermMemory = DEFAULT_LONG_TERM_MEMORY,
    settings = {},
  } = {}) {
    const normalizedSettings = this.normalizeSettings(settings);
    const recentShortTerm = shortTermMessages.slice(-normalizedSettings.shortTermLimit);
    const conversationHistoryInput = [
      buildLongTermMemoryInput(longTermMemory),
      buildWorkingMemoryInput(workingMemory),
      ...buildConversationInput(recentShortTerm),
    ];

    return {
      conversationHistoryInput,
      stats: {
        shortTermRawCount: shortTermMessages.length,
        shortTermSentCount: recentShortTerm.length,
        shortTermDroppedCount: Math.max(shortTermMessages.length - recentShortTerm.length, 0),
        shortTermLimit: normalizedSettings.shortTermLimit,
        workingMemoryCharacters: JSON.stringify(normalizeWorkingMemory(workingMemory)).length,
        longTermMemoryCharacters: JSON.stringify(normalizeLongTermMemory(longTermMemory)).length,
      },
    };
  }

  async updateMemory({
    workingMemory = DEFAULT_WORKING_MEMORY,
    longTermMemory = DEFAULT_LONG_TERM_MEMORY,
    shortTermMessages = [],
    userMessage,
    agentAnswer,
  }) {
    if (!this.client) {
      throw new Error('OPENAI_API_KEY is not configured');
    }

    const beforeWorking = normalizeWorkingMemory(workingMemory);
    const beforeLongTerm = normalizeLongTermMemory(longTermMemory);
    const response = await this.client.responses.create({
      model: this.model,
      input: [
        MEMORY_EXTRACTION_SYSTEM_MESSAGE,
        {
          role: 'user',
          content: [
            `Existing working memory JSON:\n${JSON.stringify(beforeWorking, null, 2)}`,
            `Existing long-term memory JSON:\n${JSON.stringify(beforeLongTerm, null, 2)}`,
            `Recent short-term transcript:\n${formatRecentTranscript(shortTermMessages)}`,
            `Latest user message:\n${userMessage}`,
            `Latest assistant answer:\n${agentAnswer}`,
            'Return JSON only: {"workingMemory": {...}, "longTermMemory": {...}}.',
          ].join('\n\n'),
        },
      ],
      truncation: 'disabled',
    });

    const parsed = parseMemoryJson(response.output_text);
    const nextWorking = parsed
      ? normalizeWorkingMemory({ ...beforeWorking, ...parsed.workingMemory })
      : beforeWorking;
    const nextLongTerm = parsed
      ? normalizeLongTermMemory({ ...beforeLongTerm, ...parsed.longTermMemory })
      : beforeLongTerm;

    return {
      workingMemory: nextWorking,
      longTermMemory: nextLongTerm,
      changes: {
        workingMemory: findChangedKeys(beforeWorking, nextWorking),
        longTermMemory: findChangedKeys(beforeLongTerm, nextLongTerm),
      },
    };
  }
}

export function buildConversationInput(messages) {
  return messages.map((message) => ({
    role: message.role === 'agent' ? 'assistant' : 'user',
    content: message.text,
  }));
}

export function buildMemoryTokenComparison(report) {
  return {
    fullInputTokens: report?.fullInputTokens ?? 0,
    conversationHistoryTokens: report?.conversationHistoryTokens ?? 0,
    currentRequestTokens: report?.currentRequestTokens ?? 0,
    status: report?.context?.status ?? 'unknown',
  };
}

export function normalizeWorkingMemory(memory) {
  return normalizeFixedKeys(memory, DEFAULT_WORKING_MEMORY);
}

export function normalizeLongTermMemory(memory) {
  return normalizeFixedKeys(memory, DEFAULT_LONG_TERM_MEMORY);
}

function buildWorkingMemoryInput(memory) {
  const normalized = normalizeWorkingMemory(memory);
  const body = formatMemoryBlock(normalized);

  return {
    role: 'system',
    content: `Working memory for the current task. Use it for this task, but prefer the latest user message if it conflicts.\n\n${body}`,
  };
}

function buildLongTermMemoryInput(memory) {
  const normalized = normalizeLongTermMemory(memory);
  const body = formatMemoryBlock(normalized);

  return {
    role: 'system',
    content: `Long-term memory. Stable profile facts, durable preferences, decisions, and reusable knowledge.\n\n${body}`,
  };
}

function formatMemoryBlock(memory) {
  const nonEmpty = Object.entries(memory)
    .filter(([, value]) => value.trim())
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');

  return nonEmpty || 'No saved memory in this layer yet.';
}

function parseMemoryJson(text) {
  if (typeof text !== 'string') {
    return null;
  }

  const trimmed = text.trim();
  const withoutFence = trimmed
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  try {
    return JSON.parse(withoutFence);
  } catch {
    const match = withoutFence.match(/\{[\s\S]*\}/);

    if (!match) {
      return null;
    }

    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function formatRecentTranscript(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return 'No earlier short-term messages.';
  }

  return messages
    .slice(-12)
    .map((message) => `${message.role === 'agent' ? 'assistant' : 'user'}: ${message.text}`)
    .join('\n');
}

function normalizeFixedKeys(memory, defaults) {
  return Object.fromEntries(
    Object.entries(defaults).map(([key, fallback]) => {
      const value = memory?.[key];

      return [key, formatMemoryValue(value, fallback)];
    }),
  );
}

function formatMemoryValue(value, fallback = '') {
  if (Array.isArray(value)) {
    return value.map((item) => formatMemoryValue(item)).filter(Boolean).join('; ');
  }

  if (typeof value === 'string') {
    return value;
  }

  if (value == null) {
    return fallback;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, nestedValue]) => nestedValue != null && nestedValue !== '')
      .map(([nestedKey, nestedValue]) => `${nestedKey}: ${formatMemoryValue(nestedValue)}`);

    return entries.length > 0 ? entries.join('; ') : fallback;
  }

  return String(value);
}

function findChangedKeys(before, after) {
  return Object.keys(after).filter((key) => before[key] !== after[key]);
}

function clampInteger(value, fallback, min, max) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.min(Math.max(Math.round(number), min), max);
}
