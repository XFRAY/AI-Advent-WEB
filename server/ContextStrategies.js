import { DEFAULT_FACTS } from './MessageStore.js';

export const STRATEGIES = {
  sliding: {
    id: 'sliding',
    title: 'Sliding Window',
  },
  facts: {
    id: 'facts',
    title: 'Sticky Facts',
  },
  branching: {
    id: 'branching',
    title: 'Branching',
  },
};

export const DEFAULT_LAST_MESSAGES_COUNT = 6;
const MIN_LAST_MESSAGES_COUNT = 2;
const MAX_LAST_MESSAGES_COUNT = 30;

const FACTS_SYSTEM_MESSAGE = {
  role: 'system',
  content:
    'Extract durable key-value facts from the user message for a continuing assistant conversation. Keep facts compact, factual, and useful. Return only valid JSON with these string keys: goal, constraints, preferences, decisions, openQuestions, agreements. Preserve existing facts unless the new message updates or contradicts them.',
};

export class ContextStrategies {
  constructor({ client = null, model } = {}) {
    this.client = client;
    this.model = model;
  }

  normalizeSettings(settings = {}) {
    return {
      lastMessagesCount: clampInteger(
        settings.lastMessagesCount,
        DEFAULT_LAST_MESSAGES_COUNT,
        MIN_LAST_MESSAGES_COUNT,
        MAX_LAST_MESSAGES_COUNT,
      ),
    };
  }

  previewSliding({ history = [], settings = {} } = {}) {
    const normalizedSettings = this.normalizeSettings(settings);
    return buildPreparedContext({
      strategy: STRATEGIES.sliding.id,
      history,
      conversationHistoryInput: buildConversationInput(history.slice(-normalizedSettings.lastMessagesCount)),
      lastMessagesCount: normalizedSettings.lastMessagesCount,
      facts: null,
    });
  }

  previewFacts({ history = [], facts = DEFAULT_FACTS, settings = {} } = {}) {
    const normalizedSettings = this.normalizeSettings(settings);
    const factsInput = buildFactsInput(facts);
    const recentInput = buildConversationInput(history.slice(-normalizedSettings.lastMessagesCount));

    return buildPreparedContext({
      strategy: STRATEGIES.facts.id,
      history,
      conversationHistoryInput: [...factsInput, ...recentInput],
      lastMessagesCount: normalizedSettings.lastMessagesCount,
      facts,
    });
  }

  previewBranching({ history = [], settings = {} } = {}) {
    const normalizedSettings = this.normalizeSettings(settings);
    return buildPreparedContext({
      strategy: STRATEGIES.branching.id,
      history,
      conversationHistoryInput: buildConversationInput(history),
      lastMessagesCount: normalizedSettings.lastMessagesCount,
      facts: null,
    });
  }

  previewAll({ slidingHistory = [], factsHistory = [], facts = DEFAULT_FACTS, branchingHistory = [], settings = {} } = {}) {
    const normalizedSettings = this.normalizeSettings(settings);

    return {
      sliding: this.previewSliding({ history: slidingHistory, settings: normalizedSettings }),
      facts: this.previewFacts({ history: factsHistory, facts, settings: normalizedSettings }),
      branching: this.previewBranching({ history: branchingHistory, settings: normalizedSettings }),
    };
  }

  async updateFacts({ facts = DEFAULT_FACTS, userMessage }) {
    if (!this.client) {
      throw new Error('OPENAI_API_KEY is not configured');
    }

    const response = await this.client.responses.create({
      model: this.model,
      input: [
        FACTS_SYSTEM_MESSAGE,
        {
          role: 'user',
          content: [
            `Existing facts JSON:\n${JSON.stringify(normalizeFacts(facts), null, 2)}`,
            `New user message:\n${userMessage}`,
            'Return the updated facts JSON only.',
          ].join('\n\n'),
        },
      ],
      truncation: 'disabled',
    });

    return normalizeFacts(parseFactsJson(response.output_text, facts));
  }
}

export function buildConversationInput(messages) {
  return messages.map((message) => ({
    role: message.role === 'agent' ? 'assistant' : 'user',
    content: message.text,
  }));
}

export function buildTokenComparison(strategyReports = {}) {
  return Object.fromEntries(
    Object.entries(strategyReports).map(([strategy, report]) => [
      strategy,
      {
        fullInputTokens: report?.fullInputTokens ?? 0,
        conversationHistoryTokens: report?.conversationHistoryTokens ?? 0,
        currentRequestTokens: report?.currentRequestTokens ?? 0,
        status: report?.context?.status ?? 'unknown',
      },
    ]),
  );
}

function buildFactsInput(facts) {
  const normalizedFacts = normalizeFacts(facts);
  const nonEmptyFacts = Object.entries(normalizedFacts)
    .filter(([, value]) => value.trim())
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');

  return [
    {
      role: 'system',
      content: `Sticky facts from earlier conversation. Treat them as durable context, but prefer recent user messages if they conflict.\n\n${nonEmptyFacts || 'No facts captured yet.'}`,
    },
  ];
}

function buildPreparedContext({ strategy, history, conversationHistoryInput, lastMessagesCount, facts }) {
  return {
    conversationHistoryInput,
    stats: {
      strategy,
      rawMessageCount: history.length,
      sentMessageCount: conversationHistoryInput.filter((item) => item.role !== 'system').length,
      droppedMessageCount:
        strategy === STRATEGIES.sliding.id || strategy === STRATEGIES.facts.id
          ? Math.max(history.length - lastMessagesCount, 0)
          : 0,
      factsCharacters: facts ? JSON.stringify(normalizeFacts(facts)).length : 0,
      lastMessagesCount,
    },
  };
}

function parseFactsJson(text, fallbackFacts) {
  if (typeof text !== 'string') {
    return fallbackFacts;
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
      return fallbackFacts;
    }

    try {
      return JSON.parse(match[0]);
    } catch {
      return fallbackFacts;
    }
  }
}

function normalizeFacts(facts) {
  return Object.fromEntries(
    Object.entries(DEFAULT_FACTS).map(([key, fallback]) => {
      const value = facts?.[key];

      if (Array.isArray(value)) {
        return [key, value.join('; ')];
      }

      if (typeof value === 'string') {
        return [key, value];
      }

      if (value == null) {
        return [key, fallback];
      }

      return [key, String(value)];
    }),
  );
}

function clampInteger(value, fallback, min, max) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.min(Math.max(Math.round(number), min), max);
}
