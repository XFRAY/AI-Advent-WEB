import OpenAI from 'openai';
import {
  TokenUsageAnalyzer,
  buildCumulativeUsage,
  buildUsageStats as buildTokenUsageStats,
  estimateCost,
} from './TokenUsageAnalyzer.js';

const DEFAULT_MODEL = 'gpt-4o-mini';
const REQUEST_SETTINGS = {
  temperature: null,
  reasoningEffort: null,
  endpoint: 'Responses API',
  truncation: 'disabled',
};
const SYSTEM_MESSAGE = {
  role: 'system',
  content:
    'You are a helpful assistant inside a simple educational web agent. Answer clearly and concisely.',
};

export class AgentInputError extends Error {}
export class AgentConfigurationError extends Error {}
export class AgentApiError extends Error {}
export class AgentContextOverflowError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.details = details;
  }
}

export class LlmAgent {
  constructor({ apiKey, model = DEFAULT_MODEL } = {}) {
    this.model = model;
    this.tokenUsageAnalyzer = new TokenUsageAnalyzer({ apiKey, model });

    if (!apiKey) {
      this.client = null;
      return;
    }

    this.client = new OpenAI({ apiKey });
  }

  async ask({ message: userInput, history = [], conversationHistoryInput = null } = {}) {
    const message = this.normalizeInput(userInput);

    if (!this.client) {
      throw new AgentConfigurationError('OPENAI_API_KEY is not configured');
    }

    const modelInput = this.buildModelInput({ history, message, conversationHistoryInput });
    const tokenReport = await this.buildTokenReport({ message, history, conversationHistoryInput });

    if (tokenReport.context.status === 'overflow') {
      const details = {
        contextWindow: tokenReport.context.contextWindow,
        currentRequestTokens: tokenReport.currentRequestTokens,
        fullInputTokens: tokenReport.fullInputTokens,
        historyTokens: tokenReport.historyTokens,
        remainingInputTokens: tokenReport.context.remainingInputTokens,
      };

      if (typeof tokenReport.systemInstructionTokens === 'number') {
        details.systemInstructionTokens = tokenReport.systemInstructionTokens;
      }

      if (typeof tokenReport.conversationHistoryTokens === 'number') {
        details.conversationHistoryTokens = tokenReport.conversationHistoryTokens;
      }

      throw new AgentContextOverflowError(
        `Лимит модели превышен: следующий запрос занимает ${tokenReport.fullInputTokens} ток. при лимите ${tokenReport.context.contextWindow} ток. Очистите историю или сократите сообщение.`,
        details,
      );
    }

    let response;

    try {
      response = await this.client.responses.create({
        model: this.model,
        input: modelInput,
        truncation: REQUEST_SETTINGS.truncation,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown LLM API error';
      throw new AgentApiError(`LLM API request failed: ${message}`);
    }

    const usage = this.buildUsageStats(response.usage, tokenReport);

    return {
      answer: response.output_text?.trim() || 'Модель не вернула текстовый ответ.',
      model: this.model,
      usage: {
        ...usage,
        cumulative: buildCumulativeUsage({ history, currentUsage: usage }),
      },
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

  normalizePreviewInput(userInput = '') {
    if (typeof userInput !== 'string') {
      throw new AgentInputError('Message must be a string');
    }

    return userInput.trim();
  }

  buildModelInput({ history, message, conversationHistoryInput = null }) {
    return [
      ...this.buildHistoryInput({ history, conversationHistoryInput }),
      ...this.buildCurrentInput({ message }),
    ];
  }

  async buildTokenReport({ message: userInput, history = [], conversationHistoryInput = null } = {}) {
    const message = this.normalizePreviewInput(userInput);
    const systemInput = this.buildSystemInput();
    const resolvedConversationHistoryInput =
      conversationHistoryInput ?? this.buildConversationHistoryInput({ history });
    const historyInput = [...systemInput, ...resolvedConversationHistoryInput];
    const currentInput = message ? this.buildCurrentInput({ message }) : [];
    const modelInput = [...historyInput, ...currentInput];

    return this.tokenUsageAnalyzer.buildTokenReport({
      systemInput,
      conversationHistoryInput: resolvedConversationHistoryInput,
      historyInput,
      currentInput,
      fullInput: modelInput,
    });
  }

  buildSystemInput() {
    return [SYSTEM_MESSAGE];
  }

  buildConversationHistoryInput({ history }) {
    return history.map((historyMessage) => ({
      role: historyMessage.role === 'agent' ? 'assistant' : 'user',
      content: historyMessage.text,
    }));
  }

  buildHistoryInput({ history, conversationHistoryInput = null }) {
    return [
      ...this.buildSystemInput(),
      ...(conversationHistoryInput ?? this.buildConversationHistoryInput({ history })),
    ];
  }

  buildCurrentInput({ message }) {
    return [
      {
        role: 'user',
        content: message,
      },
    ];
  }

  buildUsageStats(usage = {}, tokenReport) {
    return buildTokenUsageStats({
      model: this.model,
      responseUsage: usage,
      tokenReport,
    });
  }

  estimateCost({ inputTokens, cachedInputTokens, outputTokens }) {
    return estimateCost({
      model: this.model,
      inputTokens,
      cachedInputTokens,
      outputTokens,
    });
  }
}
