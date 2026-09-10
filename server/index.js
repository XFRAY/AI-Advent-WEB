import 'dotenv/config';
import express from 'express';
import {
  AgentApiError,
  AgentConfigurationError,
  AgentInputError,
  LlmAgent,
} from './LlmAgent.js';
import { MessageStore } from './MessageStore.js';

const app = express();
const port = Number(process.env.PORT || 3001);

const agent = new LlmAgent({
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.OPENAI_MODEL || 'gpt-5',
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
    const userMessage = messageStore.addMessage({ role: 'user', text: message });
    const result = await agent.ask({ message, history });
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

    response.status(status).json({
      error: message,
    });
  }
});

function getErrorStatus(error) {
  if (error instanceof AgentInputError) {
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
