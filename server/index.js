import 'dotenv/config';
import express from 'express';
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
  model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
});
const messageStore = new MessageStore();

app.use(express.json());

app.get('/api/health', (_request, response) => {
  response.json({ ok: true });
});

app.get('/api/messages', (_request, response) => {
  response.json({
    messages: messageStore.getMessages(),
  });
});

app.get('/api/config', (_request, response) => {
  const modelConfig = MODEL_TOKEN_CONFIG[agent.model] || null;

  response.json({
    model: agent.model,
    modelContextWindow: modelConfig?.contextWindow ?? null,
  });
});

app.post('/api/context-preview', async (request, response) => {
  try {
    const message = agent.normalizePreviewInput(request.body?.message);
    const history = messageStore.getMessages();
    const tokenReport = await agent.buildTokenReport({ message, history });

    response.json({ tokenReport });
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
    const history = messageStore.getMessages();
    const result = await agent.ask({ message, history });
    const userMessage = messageStore.addMessage({ role: 'user', text: message });
    const agentMessage = messageStore.addMessage({
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

app.listen(port, () => {
  console.log(`Agent API is running on http://localhost:${port}`);
});
