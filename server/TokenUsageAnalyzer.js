const DEFAULT_MODEL = 'gpt-4o-mini';
const TOKEN_COUNT_ENDPOINT = 'https://api.openai.com/v1/responses/input_tokens';
const NEAR_LIMIT_RATIO = 0.85;

export const MODEL_TOKEN_CONFIG = {
  'gpt-3.5-turbo': {
    contextWindow: 16_385,
    maxOutputTokens: 4_096,
    pricing: {
      input: 0.5,
      cachedInput: 0.5,
      output: 1.5,
    },
  },
  'gpt-3.5-turbo-0125': {
    contextWindow: 16_385,
    maxOutputTokens: 4_096,
    pricing: {
      input: 0.5,
      cachedInput: 0.5,
      output: 1.5,
    },
  },
  'gpt-5': {
    contextWindow: 400_000,
    maxOutputTokens: 128_000,
    pricing: {
      input: 1.25,
      cachedInput: 0.125,
      output: 10,
    },
  },
  'gpt-5-chat-latest': {
    contextWindow: 400_000,
    maxOutputTokens: 128_000,
    pricing: {
      input: 1.25,
      cachedInput: 0.125,
      output: 10,
    },
  },
  'gpt-5-mini': {
    contextWindow: 400_000,
    maxOutputTokens: 128_000,
    pricing: {
      input: 0.25,
      cachedInput: 0.025,
      output: 2,
    },
  },
  'gpt-5-nano': {
    contextWindow: 400_000,
    maxOutputTokens: 128_000,
    pricing: {
      input: 0.05,
      cachedInput: 0.005,
      output: 0.4,
    },
  },
  'gpt-4o': {
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    pricing: {
      input: 2.5,
      cachedInput: 1.25,
      output: 10,
    },
  },
  'gpt-4o-mini': {
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    pricing: {
      input: 0.15,
      cachedInput: 0.075,
      output: 0.6,
    },
  },
  'gpt-4': {
    contextWindow: 8_192,
    maxOutputTokens: 8_192,
    pricing: {
      input: 30,
      cachedInput: 30,
      output: 60,
    },
  },
};

export class TokenUsageAnalyzer {
  constructor({ apiKey, model = DEFAULT_MODEL, fetchImpl = globalThis.fetch } = {}) {
    this.apiKey = apiKey;
    this.model = model;
    this.fetchImpl = fetchImpl;
  }

  async buildTokenReport({
    systemInput = [],
    conversationHistoryInput = [],
    historyInput,
    currentInput,
    fullInput,
  }) {
    const [currentRequest, history, fullInputCount, systemInstruction, conversationHistory] =
      await Promise.all([
        this.countInputTokens(currentInput),
        this.countInputTokens(historyInput),
        this.countInputTokens(fullInput),
        this.countInputTokens(systemInput),
        this.countInputTokens(conversationHistoryInput),
      ]);
    const context = buildContextStatus({
      model: this.model,
      inputTokens: fullInputCount.inputTokens,
    });

    return {
      systemInstructionTokens: systemInstruction.inputTokens,
      conversationHistoryTokens: conversationHistory.inputTokens,
      currentRequestTokens: currentRequest.inputTokens,
      historyTokens: history.inputTokens,
      fullInputTokens: fullInputCount.inputTokens,
      countingMethod: resolveCountingMethod([
        currentRequest,
        history,
        fullInputCount,
        systemInstruction,
        conversationHistory,
      ]),
      context,
    };
  }

  async countInputTokens(input) {
    if (Array.isArray(input) && input.length === 0) {
      return {
        inputTokens: 0,
        method: 'empty',
      };
    }

    if (this.apiKey && this.fetchImpl) {
      try {
        const response = await this.fetchImpl(TOKEN_COUNT_ENDPOINT, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: this.model,
            input,
          }),
        });

        if (response.ok) {
          const data = await response.json();

          if (typeof data.input_tokens === 'number') {
            return {
              inputTokens: data.input_tokens,
              method: 'api',
            };
          }
        }
      } catch {
        // Fall through to the local estimate below.
      }
    }

    return {
      inputTokens: estimateInputTokens(input),
      method: 'fallback',
    };
  }
}

export function buildContextStatus({ model, inputTokens }) {
  const config = MODEL_TOKEN_CONFIG[model];

  if (!config) {
    return {
      model,
      inputTokens,
      contextWindow: null,
      maxOutputTokens: null,
      remainingInputTokens: null,
      status: 'unknown',
      percentUsed: null,
    };
  }

  const contextWindow = config.contextWindow;
  const remainingInputTokens = contextWindow - inputTokens;
  const percentUsed = inputTokens / contextWindow;
  const status =
    inputTokens > contextWindow
      ? 'overflow'
      : percentUsed >= NEAR_LIMIT_RATIO
        ? 'near_limit'
        : 'ok';

  return {
    model,
    inputTokens,
    contextWindow,
    modelContextWindow: config.contextWindow,
    maxOutputTokens: config.maxOutputTokens,
    remainingInputTokens,
    status,
    percentUsed,
  };
}

export function estimateCost({ model, inputTokens, cachedInputTokens = 0, outputTokens = 0 }) {
  const config = MODEL_TOKEN_CONFIG[model];

  if (!config) {
    return {
      estimatedUsd: null,
      note: 'Нет локальной таблицы цен для этой модели.',
    };
  }

  const billableInputTokens = Math.max(inputTokens - cachedInputTokens, 0);
  const estimatedUsd =
    (billableInputTokens * config.pricing.input +
      cachedInputTokens * config.pricing.cachedInput +
      outputTokens * config.pricing.output) /
    1_000_000;

  return {
    estimatedUsd,
    currency: 'USD',
    inputPerMillion: config.pricing.input,
    cachedInputPerMillion: config.pricing.cachedInput,
    outputPerMillion: config.pricing.output,
    note: 'Примерная стоимость без учета налогов, скидок, Batch API и других условий аккаунта.',
  };
}

export function buildUsageStats({ model, responseUsage = {}, tokenReport }) {
  const inputTokens = responseUsage.input_tokens ?? tokenReport?.fullInputTokens ?? 0;
  const outputTokens = responseUsage.output_tokens ?? 0;
  const totalTokens = responseUsage.total_tokens ?? inputTokens + outputTokens;
  const cachedInputTokens = responseUsage.input_tokens_details?.cached_tokens ?? 0;
  const reasoningTokens = responseUsage.output_tokens_details?.reasoning_tokens ?? 0;
  const cost = estimateCost({
    model,
    inputTokens,
    cachedInputTokens,
    outputTokens,
  });

  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningTokens,
    totalTokens,
    cost,
    tokenReport,
  };
}

export function buildCumulativeUsage({ history = [], currentUsage }) {
  const previous = history.reduce(
    (totals, message) => {
      const usage = message.metadata?.usage;
      if (!usage) {
        return totals;
      }

      return addUsageTotals(totals, usage);
    },
    createEmptyUsageTotals(),
  );

  return addUsageTotals(previous, currentUsage);
}

function createEmptyUsageTotals() {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    estimatedUsd: 0,
  };
}

function addUsageTotals(totals, usage = {}) {
  return {
    inputTokens: totals.inputTokens + (usage.inputTokens ?? 0),
    cachedInputTokens: totals.cachedInputTokens + (usage.cachedInputTokens ?? 0),
    outputTokens: totals.outputTokens + (usage.outputTokens ?? 0),
    reasoningTokens: totals.reasoningTokens + (usage.reasoningTokens ?? 0),
    totalTokens: totals.totalTokens + (usage.totalTokens ?? 0),
    estimatedUsd: totals.estimatedUsd + (usage.cost?.estimatedUsd ?? 0),
  };
}

function resolveCountingMethod(results) {
  return results.every((result) => ['api', 'empty'].includes(result.method)) ? 'api' : 'fallback';
}

function estimateInputTokens(input) {
  const text = Array.isArray(input)
    ? input.map((item) => `${item.role || ''}\n${extractTextContent(item.content)}`).join('\n\n')
    : extractTextContent(input);
  const structuralTokens = Array.isArray(input) ? input.length * 4 : 2;
  const textTokens = Math.ceil(text.length / 4);

  return Math.max(textTokens + structuralTokens, 1);
}

function extractTextContent(content) {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }

        return part?.text || part?.input_text || '';
      })
      .join('\n');
  }

  return '';
}
