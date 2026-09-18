import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'node:url';
import {
  MemoryLayers,
  buildMemoryTokenComparison,
} from './MemoryLayers.js';
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
    model: process.env.OPENAI_MODEL || 'gpt-4o',
    tokenCountingMode: process.env.OPENAI_TOKEN_COUNTING || 'estimate',
  });

export function createApp({
  agent = createDefaultAgent(),
  messageStore = new MessageStore(),
  memoryLayers = null,
} = {}) {
  const app = express();
  const memory =
    memoryLayers ||
    new MemoryLayers({
      client: agent.client,
      model: agent.model,
    });

  app.use(express.json());

  app.get('/api/health', (_request, response) => {
    response.json({ ok: true });
  });

  app.get('/api/memory', (_request, response) => {
    const shortTermMessages = messageStore.getShortTermMessages();
    const workingMemory = messageStore.getWorkingMemory();
    const longTermMemory = messageStore.getLongTermMemory();
    const activeProfile = messageStore.getActiveProfile();

    response.json({
      shortTermMessages,
      workingMemory,
      longTermMemory,
      activeProfile,
      memoryStats: buildMemoryStats({
        shortTermMessages,
        workingMemory,
        longTermMemory,
        activeProfile,
      }),
    });
  });

  app.get('/api/profiles', (_request, response) => {
    response.json({
      profiles: messageStore.getProfiles(),
      activeProfile: messageStore.getActiveProfile(),
    });
  });

  app.get('/api/profile-comparisons', (_request, response) => {
    response.json({ comparisons: messageStore.getProfileComparisons() });
  });

  app.delete('/api/profile-comparisons', (_request, response) => {
    messageStore.clearProfileComparisons();
    messageStore.clearMemory();
    response.json({ comparisons: [] });
  });

  app.post('/api/profiles/:id/activate', (request, response) => {
    const activeProfile = messageStore.setActiveProfile(request.params.id);

    if (!activeProfile) {
      response.status(404).json({ error: 'Profile not found' });
      return;
    }

    response.json({
      profiles: messageStore.getProfiles(),
      activeProfile,
    });
  });

  app.put('/api/profiles/:id', (request, response) => {
    try {
      const profile = messageStore.updateUserProfile(request.params.id, request.body);

      if (!profile) {
        response.status(404).json({ error: 'Profile not found' });
        return;
      }

      response.json({
        profile,
        activeProfile: messageStore.getActiveProfile(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid profile';
      response.status(400).json({ error: message });
    }
  });

  app.get('/api/config', (_request, response) => {
    const modelConfig = MODEL_TOKEN_CONFIG[agent.model] || null;

    response.json({
      model: agent.model,
      modelContextWindow: modelConfig?.contextWindow ?? null,
      memoryDefaults: memory.normalizeSettings(),
    });
  });

  app.post('/api/context-preview', async (request, response) => {
    try {
      const message = agent.normalizePreviewInput(request.body?.message);
      const settings = memory.normalizeSettings(request.body?.settings);
      const context = buildCurrentMemoryContext({ messageStore, memory, settings });
      const tokenReport = await agent.buildTokenReport({
        message,
        history: context.shortTermMessages,
        conversationHistoryInput: context.prepared.conversationHistoryInput,
      });

      response.json({
        tokenReport,
        stats: context.prepared.stats,
        activeProfile: context.activeProfile,
        comparison: buildMemoryTokenComparison(tokenReport),
      });
    } catch (error) {
      sendError(response, error, 'Unknown server error');
    }
  });

  app.post('/api/profile-comparison', async (request, response) => {
    try {
      const message = agent.normalizeInput(request.body?.message);
      const settings = memory.normalizeSettings(request.body?.settings);
      const profiles = messageStore.getProfiles();
      const comparisons = messageStore.getProfileComparisons();
      const results = await Promise.all(
        profiles.map(async (profile) => {
          const profileHistory = buildProfileComparisonHistory(comparisons, profile.id);
          const context = buildCurrentMemoryContext({
            messageStore,
            memory,
            settings,
            activeProfile: profile,
            shortTermMessages: profileHistory,
          });
          const result = await agent.ask({
            message,
            history: context.shortTermMessages,
            conversationHistoryInput: context.prepared.conversationHistoryInput,
          });

          return {
            profile,
            answer: result.answer,
            model: result.model,
            usage: result.usage,
            contextStats: context.prepared.stats,
          };
        }),
      );

      const comparison = messageStore.addProfileComparison({ question: message, results });
      response.json({ comparison });
    } catch (error) {
      sendError(response, error, 'Unknown server error');
    }
  });

  app.delete('/api/memory', (_request, response) => {
    messageStore.clearMemory();

    response.json({
      shortTermMessages: [],
      workingMemory: messageStore.getWorkingMemory(),
      longTermMemory: messageStore.getLongTermMemory(),
      activeProfile: messageStore.getActiveProfile(),
    });
  });

  app.post('/api/chat', async (request, response) => {
    try {
      const message = agent.normalizeInput(request.body?.message);
      const settings = memory.normalizeSettings(request.body?.settings);
      const before = buildCurrentMemoryContext({ messageStore, memory, settings });
      const result = await agent.ask({
        message,
        history: before.shortTermMessages,
        conversationHistoryInput: before.prepared.conversationHistoryInput,
      });
      const messages = saveMemoryExchange({
        messageStore,
        message,
        result,
        metadata: {
          memoryStats: before.prepared.stats,
          memoryChanges: {
            workingMemory: [],
            longTermMemory: [],
          },
          memoryUpdateStatus: 'pending',
        },
      });
      updateMemoryInBackground({
        memory,
        messageStore,
        before,
        message,
        answer: result.answer,
      });

      response.json({
        ...result,
        userMessage: messages.userMessage,
        agentMessage: messages.agentMessage,
        shortTermMessages: messageStore.getShortTermMessages(),
        workingMemory: before.workingMemory,
        longTermMemory: before.longTermMemory,
        activeProfile: before.activeProfile,
        memoryChanges: {
          workingMemory: [],
          longTermMemory: [],
        },
        memoryUpdateStatus: 'pending',
        comparison: buildMemoryTokenComparison(result.usage?.tokenReport),
      });
    } catch (error) {
      sendError(response, error, 'Unknown server error');
    }
  });

  return app;
}

function buildCurrentMemoryContext({
  messageStore,
  memory,
  settings,
  activeProfile = null,
  shortTermMessages = null,
}) {
  const resolvedShortTermMessages = shortTermMessages ?? messageStore.getShortTermMessages();
  const workingMemory = messageStore.getWorkingMemory();
  const longTermMemory = messageStore.getLongTermMemory();
  const resolvedProfile = activeProfile ?? messageStore.getActiveProfile();
  const prepared = memory.previewContext({
    shortTermMessages: resolvedShortTermMessages,
    workingMemory,
    longTermMemory,
    activeProfile: resolvedProfile,
    settings,
  });

  return {
    shortTermMessages: resolvedShortTermMessages,
    workingMemory,
    longTermMemory,
    activeProfile: resolvedProfile,
    prepared,
  };
}

function buildProfileComparisonHistory(comparisons, profileId) {
  return comparisons.flatMap((comparison) => {
    const result = comparison.results.find((item) => item.profile?.id === profileId);

    if (!result) {
      return [];
    }

    return [
      { role: 'user', text: comparison.question },
      { role: 'agent', text: result.answer },
    ];
  });
}

function saveMemoryExchange({ messageStore, message, result, metadata }) {
  const userMessage = messageStore.addShortTermMessage({
    role: 'user',
    text: message,
  });
  const agentMessage = messageStore.addShortTermMessage({
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

function updateMemoryInBackground({ memory, messageStore, before, message, answer }) {
  setImmediate(async () => {
    try {
      const memoryUpdate = await memory.updateMemory({
        workingMemory: before.workingMemory,
        longTermMemory: before.longTermMemory,
        shortTermMessages: before.shortTermMessages,
        userMessage: message,
        agentAnswer: answer,
      });
      const currentShortTermMessages = messageStore.getShortTermMessages();
      const exchangeStillExists =
        currentShortTermMessages.some((item) => item.role === 'user' && item.text === message) &&
        currentShortTermMessages.some((item) => item.role === 'agent' && item.text === answer);

      if (!exchangeStillExists) {
        return;
      }

      messageStore.saveWorkingMemory(memoryUpdate.workingMemory);
      messageStore.saveLongTermMemory(memoryUpdate.longTermMemory);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown memory update error';
      console.error(`Background memory update failed: ${message}`);
    }
  });
}

function buildMemoryStats({ shortTermMessages, workingMemory, longTermMemory, activeProfile }) {
  return {
    shortTerm: {
      rawMessageCount: shortTermMessages.length,
    },
    working: {
      characters: JSON.stringify(workingMemory).length,
    },
    longTerm: {
      characters: JSON.stringify(longTermMemory).length,
    },
    profile: {
      characters: JSON.stringify(activeProfile).length,
      activeProfileId: activeProfile?.id ?? null,
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
    console.log('Personalization: active profile, short-term, working, long-term memory');
  });

  server.on('error', (error) => {
    console.error(`Agent API failed to start: ${error.message}`);
    process.exitCode = 1;
  });
}
