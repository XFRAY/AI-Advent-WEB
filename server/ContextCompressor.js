const DEFAULT_LAST_MESSAGES_COUNT = 6;
const DEFAULT_SUMMARY_BATCH_SIZE = 10;
const MIN_LAST_MESSAGES_COUNT = 2;
const MAX_LAST_MESSAGES_COUNT = 30;
const MIN_SUMMARY_BATCH_SIZE = 2;
const MAX_SUMMARY_BATCH_SIZE = 50;

const SUMMARY_SYSTEM_MESSAGE = {
  role: 'system',
  content:
    'You compress chat history for a continuing assistant conversation. Preserve durable facts, user preferences, goals, decisions, unresolved tasks, constraints, and named entities. Omit filler. Write a compact Russian summary unless the conversation is mostly in another language.',
};

export class ContextCompressor {
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
      summaryBatchSize: clampInteger(
        settings.summaryBatchSize,
        DEFAULT_SUMMARY_BATCH_SIZE,
        MIN_SUMMARY_BATCH_SIZE,
        MAX_SUMMARY_BATCH_SIZE,
      ),
    };
  }

  preview({ history = [], summary = null, settings = {} } = {}) {
    const normalizedSettings = this.normalizeSettings(settings);
    const plan = this.buildPlan({ history, summary, settings: normalizedSettings });

    return this.buildPreparedContext({
      plan,
      summaryText: plan.effectiveSummaryText,
      summaryUsage: null,
      summaryUpdated: false,
    });
  }

  async prepare({ history = [], summary = null, settings = {} } = {}) {
    const normalizedSettings = this.normalizeSettings(settings);
    const plan = this.buildPlan({ history, summary, settings: normalizedSettings });

    if (!plan.shouldRefreshSummary) {
      return this.buildPreparedContext({
        plan,
        summaryText: plan.effectiveSummaryText,
        summaryUsage: null,
        summaryUpdated: false,
      });
    }

    const generated = await this.generateSummary({
      previousSummary: plan.canReuseSummary ? summary?.text || '' : '',
      messages: plan.messagesToSummarize,
    });

    return this.buildPreparedContext({
      plan,
      summaryText: generated.text,
      summaryUsage: generated.usage,
      summaryUpdated: true,
    });
  }

  buildPlan({ history, summary, settings }) {
    const recentMessages = history.slice(-settings.lastMessagesCount);
    const olderMessages = history.slice(0, Math.max(history.length - settings.lastMessagesCount, 0));
    const canReuseSummary =
      summary &&
      summary.lastMessagesCount === settings.lastMessagesCount &&
      summary.summaryBatchSize === settings.summaryBatchSize &&
      summary.summarizedMessageCount <= olderMessages.length;
    const summarizedMessageCount = canReuseSummary ? summary.summarizedMessageCount : 0;
    const pendingMessages = olderMessages.slice(summarizedMessageCount);
    const hasBatchReady = pendingMessages.length >= settings.summaryBatchSize;
    const shouldRefreshSummary =
      olderMessages.length > 0 && (!canReuseSummary || hasBatchReady);
    const messagesToSummarize = shouldRefreshSummary ? olderMessages : olderMessages.slice(0, summarizedMessageCount);
    const effectiveSummaryText = this.buildEffectiveSummaryText({
      summaryText: canReuseSummary ? summary?.text || '' : '',
      pendingMessages,
    });

    return {
      settings,
      recentMessages,
      olderMessages,
      pendingMessages,
      messagesToSummarize,
      summarizedMessageCount,
      shouldRefreshSummary,
      canReuseSummary,
      effectiveSummaryText,
    };
  }

  buildPreparedContext({ plan, summaryText, summaryUsage, summaryUpdated }) {
    const summaryInput = summaryText
      ? [
          {
            role: 'system',
            content: `Summary of earlier conversation. Use it as context, but prefer the recent raw messages when they conflict.\n\n${summaryText}`,
          },
        ]
      : [];
    const recentInput = buildConversationInput(plan.recentMessages);

    return {
      conversationHistoryInput: [...summaryInput, ...recentInput],
      summary: summaryText
        ? {
            text: summaryText,
            summarizedMessageCount: summaryUpdated
              ? plan.olderMessages.length
              : plan.summarizedMessageCount,
            lastMessagesCount: plan.settings.lastMessagesCount,
            summaryBatchSize: plan.settings.summaryBatchSize,
            metadata: summaryUsage
              ? {
                  usage: summaryUsage,
                }
              : null,
          }
        : null,
      stats: {
        mode: 'compressed',
        rawRecentMessageCount: plan.recentMessages.length,
        summarizedMessageCount: summaryUpdated
          ? plan.olderMessages.length
          : plan.summarizedMessageCount,
        pendingSummaryMessageCount: summaryUpdated ? 0 : plan.pendingMessages.length,
        coveredBySummaryMessageCount: plan.olderMessages.length,
        summaryCharacters: summaryText.length,
        summaryUpdated,
        lastMessagesCount: plan.settings.lastMessagesCount,
        summaryBatchSize: plan.settings.summaryBatchSize,
      },
    };
  }

  async generateSummary({ previousSummary, messages }) {
    if (!this.client) {
      throw new Error('OPENAI_API_KEY is not configured');
    }

    const transcript = buildTranscript(messages);
    const response = await this.client.responses.create({
      model: this.model,
      input: [
        SUMMARY_SYSTEM_MESSAGE,
        {
          role: 'user',
          content: [
            previousSummary ? `Existing summary:\n${previousSummary}` : 'Existing summary: empty',
            'Messages to compress:',
            transcript,
            'Return only the updated compact summary.',
          ].join('\n\n'),
        },
      ],
      truncation: 'disabled',
    });

    return {
      text: response.output_text?.trim() || 'Summary is empty.',
      usage: response.usage || null,
    };
  }

  buildEffectiveSummaryText({ summaryText, pendingMessages }) {
    const parts = [];

    if (summaryText) {
      parts.push(summaryText);
    }

    if (pendingMessages.length > 0) {
      parts.push(`Pending older messages not yet folded into the compact summary:\n${buildTranscript(pendingMessages)}`);
    }

    return parts.join('\n\n');
  }
}

export function buildConversationInput(messages) {
  return messages.map((message) => ({
    role: message.role === 'agent' ? 'assistant' : 'user',
    content: message.text,
  }));
}

export function buildTokenComparison(fullTokenReport, compressedTokenReport) {
  const fullInputTokens = fullTokenReport?.fullInputTokens ?? 0;
  const compressedInputTokens = compressedTokenReport?.fullInputTokens ?? 0;
  const inputTokenSavings = Math.max(fullInputTokens - compressedInputTokens, 0);
  const inputTokenSavingsPercent =
    fullInputTokens > 0 ? Math.round((inputTokenSavings / fullInputTokens) * 1000) / 10 : 0;

  return {
    fullInputTokens,
    compressedInputTokens,
    inputTokenSavings,
    inputTokenSavingsPercent,
  };
}

function buildTranscript(messages) {
  if (messages.length === 0) {
    return 'No previous messages.';
  }

  return messages
    .map((message, index) => {
      const label = message.role === 'agent' ? 'Assistant' : 'User';
      return `${index + 1}. ${label}: ${message.text}`;
    })
    .join('\n');
}

function clampInteger(value, fallback, min, max) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.min(Math.max(Math.round(number), min), max);
}
