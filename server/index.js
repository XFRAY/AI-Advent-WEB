import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'node:url';
import {
  ContextStrategies,
  DEFAULT_LAST_MESSAGES_COUNT,
  STRATEGIES,
  buildTokenComparison,
} from './ContextStrategies.js';
import {
  AgentApiError,
  AgentConfigurationError,
  AgentContextOverflowError,
  AgentInputError,
  LlmAgent,
} from './LlmAgent.js';
import { MessageStore } from './MessageStore.js';
import { MODEL_TOKEN_CONFIG } from './TokenUsageAnalyzer.js';

const port = Number(process.env.PORT || 3001);

const createDefaultAgent = () =>
  new LlmAgent({
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  });

export function createApp({
  agent = createDefaultAgent(),
  messageStore = new MessageStore(),
  contextStrategies = null,
} = {}) {
  const app = express();
  const strategies =
    contextStrategies ||
    new ContextStrategies({
      client: agent.client,
      model: agent.model,
    });

  app.use(express.json());

  app.get('/api/health', (_request, response) => {
    response.json({ ok: true });
  });

  app.get('/api/messages', (_request, response) => {
    const branchingState = messageStore.getBranchingState();
    const activeBranchId = branchingState.activeBranchId;
    const slidingMessages = messageStore.getMessages(STRATEGIES.sliding.id);
    const factsMessages = messageStore.getMessages(STRATEGIES.facts.id);
    const branchingMessages = messageStore.getMessages(STRATEGIES.branching.id, {
      branchId: activeBranchId === 'main' ? null : activeBranchId,
    });
    const facts = messageStore.getFacts();

    response.json({
      slidingMessages,
      factsMessages,
      branchingMessages,
      messages: slidingMessages,
      facts,
      branchingState,
      strategyStats: buildStrategyStats({
        slidingMessages,
        factsMessages,
        branchingMessages,
        facts,
      }),
    });
  });

  app.get('/api/config', (_request, response) => {
    const modelConfig = MODEL_TOKEN_CONFIG[agent.model] || null;

    response.json({
      model: agent.model,
      modelContextWindow: modelConfig?.contextWindow ?? null,
      strategyDefaults: strategies.normalizeSettings(),
    });
  });

  app.post('/api/context-preview', async (request, response) => {
    try {
      const message = agent.normalizePreviewInput(request.body?.message);
      const settings = strategies.normalizeSettings(request.body?.settings);
      const context = buildCurrentPreparedContexts({ messageStore, strategies, settings });
      const [slidingReport, factsReport, branchingReport] = await Promise.all([
        agent.buildTokenReport({
          message,
          history: context.histories.sliding,
          conversationHistoryInput: context.prepared.sliding.conversationHistoryInput,
        }),
        agent.buildTokenReport({
          message,
          history: context.histories.facts,
          conversationHistoryInput: context.prepared.facts.conversationHistoryInput,
        }),
        agent.buildTokenReport({
          message,
          history: context.histories.branching,
          conversationHistoryInput: context.prepared.branching.conversationHistoryInput,
        }),
      ]);

      response.json({
        sliding: {
          tokenReport: slidingReport,
          stats: context.prepared.sliding.stats,
        },
        facts: {
          tokenReport: factsReport,
          stats: context.prepared.facts.stats,
        },
        branching: {
          tokenReport: branchingReport,
          stats: context.prepared.branching.stats,
        },
        comparison: buildTokenComparison({
          sliding: slidingReport,
          facts: factsReport,
          branching: branchingReport,
        }),
      });
    } catch (error) {
      sendError(response, error, 'Unknown server error');
    }
  });

  app.delete('/api/messages', (_request, response) => {
    messageStore.clearMessages();

    response.json({
      slidingMessages: [],
      factsMessages: [],
      branchingMessages: [],
      facts: messageStore.getFacts(),
      branchingState: messageStore.getBranchingState(),
    });
  });

  app.post('/api/chat/compare', async (request, response) => {
    try {
      const message = agent.normalizeInput(request.body?.message);
      const settings = strategies.normalizeSettings(request.body?.settings);
      const before = buildCurrentPreparedContexts({ messageStore, strategies, settings });
      const factsContext = strategies.previewFacts({
        history: before.histories.facts,
        facts: before.facts,
        settings,
      });
      const [slidingResult, factsResult, branchingResult] = await Promise.all([
        agent.ask({
          message,
          history: before.histories.sliding,
          conversationHistoryInput: before.prepared.sliding.conversationHistoryInput,
        }),
        agent.ask({
          message,
          history: before.histories.facts,
          conversationHistoryInput: factsContext.conversationHistoryInput,
        }),
        agent.ask({
          message,
          history: before.histories.branching,
          conversationHistoryInput: before.prepared.branching.conversationHistoryInput,
        }),
      ]);
      const branchId =
        before.branchingState.activeBranchId === 'main' ? null : before.branchingState.activeBranchId;
      const updatedFacts = await strategies.updateFacts({
        facts: before.facts,
        userMessage: message,
      });
      const savedFacts = messageStore.saveFacts(updatedFacts);
      const slidingMessages = saveStrategyExchange({
        messageStore,
        mode: STRATEGIES.sliding.id,
        message,
        result: slidingResult,
        metadata: {
          strategy: STRATEGIES.sliding.id,
          stats: before.prepared.sliding.stats,
        },
      });

      messageStore.trimMessages({
        mode: STRATEGIES.sliding.id,
        keepCount: settings.lastMessagesCount,
      });

      const factsMessages = saveStrategyExchange({
        messageStore,
        mode: STRATEGIES.facts.id,
        message,
        result: factsResult,
        metadata: {
          strategy: STRATEGIES.facts.id,
          stats: factsContext.stats,
          facts: savedFacts,
        },
      });
      const branchingMessages = saveStrategyExchange({
        messageStore,
        mode: STRATEGIES.branching.id,
        branchId,
        message,
        result: branchingResult,
        metadata: {
          strategy: STRATEGIES.branching.id,
          branchId: before.branchingState.activeBranchId,
          stats: before.prepared.branching.stats,
        },
      });

      response.json({
        sliding: {
          ...slidingResult,
          userMessage: slidingMessages.userMessage,
          agentMessage: slidingMessages.agentMessage,
          messages: messageStore.getMessages(STRATEGIES.sliding.id),
        },
        facts: {
          ...factsResult,
          userMessage: factsMessages.userMessage,
          agentMessage: factsMessages.agentMessage,
          messages: messageStore.getMessages(STRATEGIES.facts.id),
          facts: savedFacts,
        },
        branching: {
          ...branchingResult,
          userMessage: branchingMessages.userMessage,
          agentMessage: branchingMessages.agentMessage,
          messages: messageStore.getMessages(STRATEGIES.branching.id, { branchId }),
          branchingState: before.branchingState,
        },
        comparison: buildTokenComparison({
          sliding: slidingResult.usage?.tokenReport,
          facts: factsResult.usage?.tokenReport,
          branching: branchingResult.usage?.tokenReport,
        }),
      });
    } catch (error) {
      sendError(response, error, 'Unknown server error');
    }
  });

  app.post('/api/branching/checkpoint', (_request, response) => {
    try {
      const current = messageStore.getBranchingState();
      const sourceBranchId = current.activeBranchId === 'main' ? null : current.activeBranchId;
      const branchingState = messageStore.createBranchingCheckpoint({ sourceBranchId });

      response.json({
        branchingState,
        branchingMessages: messageStore.getMessages(STRATEGIES.branching.id, { branchId: 'A' }),
      });
    } catch (error) {
      sendError(response, error, 'Unknown server error');
    }
  });

  app.post('/api/branching/active-branch', (request, response) => {
    try {
      const branchId = request.body?.branchId;
      const branchingState = messageStore.setActiveBranch(branchId);
      const effectiveBranchId = branchingState.activeBranchId === 'main' ? null : branchingState.activeBranchId;

      response.json({
        branchingState,
        branchingMessages: messageStore.getMessages(STRATEGIES.branching.id, {
          branchId: effectiveBranchId,
        }),
      });
    } catch (error) {
      sendError(response, error, 'Unknown server error');
    }
  });

  return app;
}

function buildCurrentPreparedContexts({ messageStore, strategies, settings }) {
  const facts = messageStore.getFacts();
  const branchingState = messageStore.getBranchingState();
  const branchId = branchingState.activeBranchId === 'main' ? null : branchingState.activeBranchId;
  const histories = {
    sliding: messageStore.getMessages(STRATEGIES.sliding.id),
    facts: messageStore.getMessages(STRATEGIES.facts.id),
    branching: messageStore.getMessages(STRATEGIES.branching.id, { branchId }),
  };
  const prepared = strategies.previewAll({
    slidingHistory: histories.sliding,
    factsHistory: histories.facts,
    facts,
    branchingHistory: histories.branching,
    settings,
  });

  return {
    facts,
    branchingState,
    histories,
    prepared,
  };
}

function saveStrategyExchange({ messageStore, mode, branchId = null, message, result, metadata }) {
  const userMessage = messageStore.addMessage({
    mode,
    branchId,
    role: 'user',
    text: message,
  });
  const agentMessage = messageStore.addMessage({
    mode,
    branchId,
    role: 'agent',
    text: result.answer,
    metadata: {
      model: result.model,
      usage: result.usage,
      settings: result.settings,
      ...metadata,
    },
  });

  return {
    userMessage,
    agentMessage,
  };
}

function buildStrategyStats({ slidingMessages, factsMessages, branchingMessages, facts }) {
  return {
    sliding: {
      rawMessageCount: slidingMessages.length,
    },
    facts: {
      rawMessageCount: factsMessages.length,
      factsCharacters: JSON.stringify(facts).length,
    },
    branching: {
      rawMessageCount: branchingMessages.length,
    },
  };
}

function sendError(response, error, fallback) {
  const message = error instanceof Error ? error.message : fallback;
  const status = getErrorStatus(error);
  const body = { error: message };

  if (error instanceof AgentContextOverflowError) {
    body.details = error.details;
  }

  response.status(status).json(body);
}

function getErrorStatus(error) {
  if (error instanceof AgentInputError || error instanceof AgentContextOverflowError) {
    return 400;
  }

  if (error instanceof AgentConfigurationError) {
    return 500;
  }

  if (error instanceof AgentApiError) {
    return 502;
  }

  return 500;
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
  const app = createApp();
  const server = app.listen(port, () => {
    console.log(`Agent API is running on http://localhost:${port}`);
    console.log(`Default last messages count: ${DEFAULT_LAST_MESSAGES_COUNT}`);
  });

  server.on('error', (error) => {
    console.error(`Agent API failed to start: ${error.message}`);
    process.exitCode = 1;
  });
}
