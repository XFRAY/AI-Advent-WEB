import OpenAI from 'openai';

const DEFAULT_MODEL = 'gpt-5';
const REQUEST_SETTINGS = {
  temperature: null,
  reasoningEffort: null,
  endpoint: 'Responses API',
};

const MODEL_PRICING_USD_PER_1M_TOKENS = {
  'gpt-5': {
    input: 1.25,
    cachedInput: 0.125,
    output: 10,
  },
  'gpt-5-chat-latest': {
    input: 1.25,
    cachedInput: 0.125,
    output: 10,
  },
  'gpt-5-mini': {
    input: 0.25,
    cachedInput: 0.025,
    output: 2,
  },
  'gpt-5-nano': {
    input: 0.05,
    cachedInput: 0.005,
    output: 0.4,
  },
};

export class AgentInputError extends Error {}
export class AgentConfigurationError extends Error {}
export class AgentApiError extends Error {}

export class LlmAgent {
  constructor({ apiKey, model = DEFAULT_MODEL } = {}) {
    this.model = model;

    if (!apiKey) {
      this.client = null;
      return;
    }

    this.client = new OpenAI({ apiKey });
  }

  async ask(userInput) {
    const message = this.normalizeInput(userInput);

    if (!this.client) {
      throw new AgentConfigurationError('OPENAI_API_KEY is not configured');
    }

    let response;

    try {
      response = await this.client.responses.create({
        model: this.model,
        input: [
          {
            role: 'system',
            content:
              'You are a helpful assistant inside a simple educational web agent. Answer clearly and concisely.',
          },
          {
            role: 'user',
            content: message,
          },
        ],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown LLM API error';
      throw new AgentApiError(`LLM API request failed: ${message}`);
    }

    return {
      answer: response.output_text?.trim() || 'Модель не вернула текстовый ответ.',
      model: this.model,
      usage: this.buildUsageStats(response.usage),
      settings: REQUEST_SETTINGS,
    };
  }

  normalizeInput(userInput) {
    if (typeof userInput !== 'string') {
      throw new AgentInputError('Message must be a string');
    }

    const message = userInput.trim();

    if (!message) {
      throw new AgentInputError('Message cannot be empty');
    }

    return message;
  }

  buildUsageStats(usage = {}) {
    const inputTokens = usage.input_tokens ?? 0;
    const outputTokens = usage.output_tokens ?? 0;
    const totalTokens = usage.total_tokens ?? inputTokens + outputTokens;
    const cachedInputTokens = usage.input_tokens_details?.cached_tokens ?? 0;
    const reasoningTokens = usage.output_tokens_details?.reasoning_tokens ?? 0;
    const cost = this.estimateCost({
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
    };
  }

  estimateCost({ inputTokens, cachedInputTokens, outputTokens }) {
    const pricing = MODEL_PRICING_USD_PER_1M_TOKENS[this.model];

    if (!pricing) {
      return {
        estimatedUsd: null,
        note: 'Нет локальной таблицы цен для этой модели.',
      };
    }

    const billableInputTokens = Math.max(inputTokens - cachedInputTokens, 0);
    const estimatedUsd =
      (billableInputTokens * pricing.input +
        cachedInputTokens * pricing.cachedInput +
        outputTokens * pricing.output) /
      1_000_000;

    return {
      estimatedUsd,
      currency: 'USD',
      inputPerMillion: pricing.input,
      cachedInputPerMillion: pricing.cachedInput,
      outputPerMillion: pricing.output,
      note: 'Примерная стоимость без учета налогов, скидок, Batch API и других условий аккаунта.',
    };
  }
}
