import 'dotenv/config';
import express from 'express';
import {
  AgentApiError,
  AgentConfigurationError,
  AgentInputError,
  LlmAgent,
} from './LlmAgent.js';

const app = express();
const port = Number(process.env.PORT || 3001);

const agent = new LlmAgent({
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.OPENAI_MODEL || 'gpt-5',
});

app.use(express.json());

app.get('/api/health', (_request, response) => {
  response.json({ ok: true });
});

app.post('/api/chat', async (request, response) => {
  try {
    const result = await agent.ask(request.body?.message);
    response.json(result);
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
