import 'dotenv/config';
import express from 'express';
import { ContextCompressor, buildTokenComparison } from './ContextCompressor.js';
import {
  AgentApiError,
  AgentConfigurationError,
  AgentContextOverflowError,
  AgentInputError,
  LlmAgent,
} from './LlmAgent.js';
import { MessageStore } from './MessageStore.js';
import { MODEL_TOKEN_CONFIG } from './TokenUsageAnalyzer.js';

const app = express();
const port = Number(process.env.PORT || 3001);

const agent = new LlmAgent({
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
});
const contextCompressor = new ContextCompressor({
  client: agent.client,
  model: agent.model,
});
const messageStore = new MessageStore();

app.use(express.json());

app.get('/api/health', (_request, response) => {
  response.json({ ok: true });
});

app.get('/api/messages', (_request, response) => {
  const fullMessages = messageStore.getMessages('full');
  const compressedMessages = messageStore.getMessages('compressed');
  const summary = messageStore.getSummary('compressed');

  response.json({
    messages: fullMessages,
    fullMessages,
    compressedMessages,
    summary,
    compressionStats: buildCompressionStats({ compressedMessages, summary }),
  });
});

app.get('/api/config', (_request, response) => {
  const modelConfig = MODEL_TOKEN_CONFIG[agent.model] || null;

  response.json({
    model: agent.model,
    modelContextWindow: modelConfig?.contextWindow ?? null,
    compressionDefaults: contextCompressor.normalizeSettings(),
  });
});

app.post('/api/context-preview', async (request, response) => {
  try {
    const message = agent.normalizePreviewInput(request.body?.message);
    const compressionSettings = contextCompressor.normalizeSettings(request.body?.compression);
    const fullHistory = messageStore.getMessages('full');
    const compressedHistory = messageStore.getMessages('compressed');
    const compressedPreview = contextCompressor.preview({
      history: compressedHistory,
      summary: messageStore.getSummary('compressed'),
      settings: compressionSettings,
    });
    const [fullTokenReport, compressedTokenReport] = await Promise.all([
      agent.buildTokenReport({ message, history: fullHistory }),
      agent.buildTokenReport({
        message,
        history: compressedHistory,
        conversationHistoryInput: compressedPreview.conversationHistoryInput,
      }),
    ]);

    response.json({
      tokenReport: fullTokenReport,
      full: {
        tokenReport: fullTokenReport,
      },
      compressed: {
        tokenReport: compressedTokenReport,
        compressionStats: compressedPreview.stats,
      },
      comparison: buildTokenComparison(fullTokenReport, compressedTokenReport),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    const status = getErrorStatus(error);

    response.status(status).json({
      error: message,
    });
  }
});

app.delete('/api/messages', (_request, response) => {
  messageStore.clearMessages();

  response.json({
    messages: [],
  });
});

app.post('/api/chat', async (request, response) => {
  try {
    const message = agent.normalizeInput(request.body?.message);
    const history = messageStore.getMessages('full');
    const result = await agent.ask({ message, history });
    const userMessage = messageStore.addMessage({ mode: 'full', role: 'user', text: message });
    const agentMessage = messageStore.addMessage({
      mode: 'full',
      role: 'agent',
      text: result.answer,
      metadata: {
        model: result.model,
        usage: result.usage,
        settings: result.settings,
      },
    });

    response.json({
      ...result,
      userMessage,
      agentMessage,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    const status = getErrorStatus(error);
    const body = { error: message };

    if (error instanceof AgentContextOverflowError) {
      body.details = error.details;
    }

    response.status(status).json(body);
  }
});

app.post('/api/chat/compare', async (request, response) => {
  try {
    const message = agent.normalizeInput(request.body?.message);
    const compressionSettings = contextCompressor.normalizeSettings(request.body?.compression);
    const fullHistory = messageStore.getMessages('full');
    const compressedHistory = messageStore.getMessages('compressed');
    const compressedContext = await contextCompressor.prepare({
      history: compressedHistory,
      summary: messageStore.getSummary('compressed'),
      settings: compressionSettings,
    });
    const [fullResult, compressedResult] = await Promise.all([
      agent.ask({ message, history: fullHistory }),
      agent.ask({
        message,
        history: compressedHistory,
        conversationHistoryInput: compressedContext.conversationHistoryInput,
      }),
    ]);
    let savedSummary = messageStore.getSummary('compressed');

    if (compressedContext.summary && compressedContext.stats.summaryUpdated) {
      savedSummary = messageStore.saveSummary({
        mode: 'compressed',
        text: compressedContext.summary.text,
        summarizedMessageCount: compressedContext.summary.summarizedMessageCount,
        lastMessagesCount: compressedContext.summary.lastMessagesCount,
        summaryBatchSize: compressedContext.summary.summaryBatchSize,
        metadata: compressedContext.summary.metadata,
      });
    }

    const fullUserMessage = messageStore.addMessage({
      mode: 'full',
      role: 'user',
      text: message,
    });
    const compressedUserMessage = messageStore.addMessage({
      mode: 'compressed',
      role: 'user',
      text: message,
    });
    const fullAgentMessage = messageStore.addMessage({
      mode: 'full',
      role: 'agent',
      text: fullResult.answer,
      metadata: {
        model: fullResult.model,
        mode: 'full',
        usage: fullResult.usage,
        settings: fullResult.settings,
      },
    });
    const compressedAgentMessage = messageStore.addMessage({
      mode: 'compressed',
      role: 'agent',
      text: compressedResult.answer,
      metadata: {
        model: compressedResult.model,
        mode: 'compressed',
        compression: compressedContext.stats,
        usage: compressedResult.usage,
        settings: compressedResult.settings,
      },
    });
    const comparison = buildTokenComparison(
      fullResult.usage?.tokenReport,
      compressedResult.usage?.tokenReport,
    );

    response.json({
      full: {
        ...fullResult,
        userMessage: fullUserMessage,
        agentMessage: fullAgentMessage,
      },
      compressed: {
        ...compressedResult,
        userMessage: compressedUserMessage,
        agentMessage: compressedAgentMessage,
        summary: savedSummary,
        compressionStats: compressedContext.stats,
      },
      comparison,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    const status = getErrorStatus(error);
    const body = { error: message };

    if (error instanceof AgentContextOverflowError) {
      body.details = error.details;
    }

    response.status(status).json(body);
  }
});

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

function buildCompressionStats({ compressedMessages, summary }) {
  return {
    rawMessageCount: compressedMessages.length,
    summarizedMessageCount: summary?.summarizedMessageCount ?? 0,
    summaryCharacters: summary?.text?.length ?? 0,
    lastMessagesCount: summary?.lastMessagesCount ?? null,
    summaryBatchSize: summary?.summaryBatchSize ?? null,
  };
}

const server = app.listen(port, () => {
  console.log(`Agent API is running on http://localhost:${port}`);
});

server.on('error', (error) => {
  console.error(`Agent API failed to start: ${error.message}`);
  process.exitCode = 1;
});
