import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentContextOverflowError, LlmAgent } from './LlmAgent.js';

test('LlmAgent blocks real context overflow before calling the model', async () => {
  const agent = new LlmAgent({ apiKey: 'test-key', model: 'gpt-5-nano' });
  let modelWasCalled = false;

  agent.client = {
    responses: {
      create: async () => {
        modelWasCalled = true;
        return {
          output_text: 'Should not happen',
          usage: {},
        };
      },
    },
  };
  agent.tokenUsageAnalyzer = {
    async buildTokenReport() {
      return {
        currentRequestTokens: 10,
        historyTokens: 400_001,
        fullInputTokens: 400_011,
        countingMethod: 'api',
        context: {
          status: 'overflow',
          contextWindow: 400_000,
          remainingInputTokens: -11,
        },
      };
    },
  };

  await assert.rejects(
    () => agent.ask({ message: 'Hello', history: [] }),
    (error) => {
      assert.ok(error instanceof AgentContextOverflowError);
      assert.deepEqual(error.details, {
        contextWindow: 400_000,
        currentRequestTokens: 10,
        fullInputTokens: 400_011,
        historyTokens: 400_001,
        remainingInputTokens: -11,
      });

      return true;
    },
  );
  assert.equal(modelWasCalled, false);
});

test('LlmAgent can preview context without a draft message', async () => {
  const agent = new LlmAgent({ apiKey: 'test-key', model: 'gpt-5-nano' });
  let receivedCurrentInput = null;
  let receivedConversationHistoryInput = null;

  agent.tokenUsageAnalyzer = {
    async buildTokenReport({ conversationHistoryInput, currentInput }) {
      receivedCurrentInput = currentInput;
      receivedConversationHistoryInput = conversationHistoryInput;

      return {
        systemInstructionTokens: 26,
        conversationHistoryTokens: 1,
        currentRequestTokens: 0,
        historyTokens: 27,
        fullInputTokens: 27,
        countingMethod: 'api',
        context: {
          status: 'ok',
          contextWindow: 16_385,
          remainingInputTokens: 16_358,
        },
      };
    },
  };

  const tokenReport = await agent.buildTokenReport({
    message: '',
    history: [{ role: 'agent', text: 'Saved answer' }],
  });

  assert.deepEqual(receivedCurrentInput, []);
  assert.deepEqual(receivedConversationHistoryInput, [{ role: 'assistant', content: 'Saved answer' }]);
  assert.equal(tokenReport.context.status, 'ok');
  assert.equal(tokenReport.systemInstructionTokens, 26);
  assert.equal(tokenReport.conversationHistoryTokens, 1);
  assert.equal(tokenReport.currentRequestTokens, 0);
});

test('LlmAgent sends the full model input on successful requests', async () => {
  const agent = new LlmAgent({ apiKey: 'test-key', model: 'gpt-5-nano' });
  let receivedInput = null;

  agent.client = {
    responses: {
      create: async ({ input }) => {
        receivedInput = input;

        return {
          output_text: 'Done',
          usage: {
            input_tokens: 25,
            output_tokens: 5,
            total_tokens: 30,
          },
        };
      },
    },
  };
  agent.tokenUsageAnalyzer = {
    async buildTokenReport() {
      return {
        currentRequestTokens: 4,
        historyTokens: 12,
        fullInputTokens: 16,
        countingMethod: 'api',
        context: {
          status: 'ok',
          contextWindow: 1000,
          remainingInputTokens: 984,
        },
      };
    },
  };

  const response = await agent.ask({
    message: 'Next',
    history: [{ role: 'agent', text: 'Previous answer' }],
  });

  assert.equal(response.answer, 'Done');
  assert.equal(receivedInput.at(-1).role, 'user');
  assert.equal(receivedInput.at(-1).content, 'Next');
});

test('LlmAgent can send a prepared compressed context instead of raw history', async () => {
  const agent = new LlmAgent({ apiKey: 'test-key', model: 'gpt-5-nano' });
  let receivedInput = null;
  let receivedConversationHistoryInput = null;
  const compressedContext = [
    {
      role: 'system',
      content: 'Summary of earlier conversation.',
    },
    {
      role: 'user',
      content: 'Recent raw message',
    },
  ];

  agent.client = {
    responses: {
      create: async ({ input }) => {
        receivedInput = input;

        return {
          output_text: 'Compressed done',
          usage: {
            input_tokens: 20,
            output_tokens: 5,
            total_tokens: 25,
          },
        };
      },
    },
  };
  agent.tokenUsageAnalyzer = {
    async buildTokenReport({ conversationHistoryInput }) {
      receivedConversationHistoryInput = conversationHistoryInput;

      return {
        currentRequestTokens: 4,
        historyTokens: 12,
        fullInputTokens: 16,
        countingMethod: 'api',
        context: {
          status: 'ok',
          contextWindow: 1000,
          remainingInputTokens: 984,
        },
      };
    },
  };

  await agent.ask({
    message: 'Next',
    history: [{ role: 'agent', text: 'This raw history should not be sent' }],
    conversationHistoryInput: compressedContext,
  });

  assert.equal(receivedInput[1].content, 'Summary of earlier conversation.');
  assert.equal(receivedInput[2].content, 'Recent raw message');
  assert.equal(receivedInput.some((item) => item.content === 'This raw history should not be sent'), false);
  assert.equal(receivedConversationHistoryInput, compressedContext);
});
