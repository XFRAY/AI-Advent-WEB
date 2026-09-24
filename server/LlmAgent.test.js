import test from 'node:test';
import assert from 'node:assert/strict';
import { LlmAgent } from './LlmAgent.js';
const call = (args = '{}', name = 'altegio_list_services') => ({ type: 'function_call', name, arguments: args, call_id: 'call-1' });
function setup(responses, output = { structuredContent: { services: [{ title: 'Стрижка', price_min: 50 }], truncated: false } }) {
  const requests = [], executed = [];
  const mcp = { listTools: async () => [{ name: 'altegio_list_services', description: 'Services', inputSchema: { type: 'object' } }], callTool: async (...args) => { executed.push(args); return output; } };
  const client = { responses: { create: async request => { requests.push(structuredClone(request)); return responses[Math.min(requests.length - 1, responses.length - 1)]; } } };
  return { agent: new LlmAgent({ client, mcp }), requests, executed };
}
test('round trip preserves reasoning, call_id, results and returns trace', async () => {
  const reasoning = { type: 'reasoning', id: 'r1', summary: [], encrypted_content: 'encrypted' };
  const { agent, requests, executed } = setup([{ output: [reasoning, call('{"query":"стрижка"}')] }, { output: [], output_text: 'Стрижка — от 50.' }]);
  const result = await agent.ask({ message: 'Услуги?', history: [{ role: 'user', text: 'Привет' }, { role: 'agent', text: 'Здравствуйте' }] });
  assert.equal(executed.length, 1); assert.equal(requests.length, 2);
  assert.ok(requests[1].input.some(item => item.type === 'reasoning'));
  const output = requests[1].input.find(item => item.type === 'function_call_output');
  assert.equal(output.call_id, 'call-1'); assert.equal(JSON.parse(output.output).services[0].price_min, 50);
  assert.equal(result.toolCalls[0].status, 'success'); assert.equal(result.answer, 'Стрижка — от 50.');
});
test('ordinary conversation does not call MCP tool', async () => {
  const { agent, executed } = setup([{ output: [], output_text: 'Привет!' }]);
  assert.equal((await agent.ask({ message: 'Привет' })).answer, 'Привет!'); assert.equal(executed.length, 0);
});
test('rejects unknown tools, invalid JSON and invalid arguments before execution', async () => {
  for (const item of [call('{'), call('{"limit":0}'), call('{}', 'unknown')]) {
    const { agent, executed, requests } = setup([{ output: [item] }, { output: [], output_text: 'Ошибка инструмента.' }]);
    const result = await agent.ask({ message: 'Услуги' });
    assert.equal(executed.length, 0); assert.equal(result.toolCalls[0].status, 'error');
    assert.ok(JSON.parse(requests[1].input.at(-1).output).error);
  }
});
test('returns tool errors to model', async () => {
  const { agent, requests } = setup([{ output: [call()] }, { output: [], output_text: 'Нет доступа.' }], { isError: true, content: [{ type: 'text', text: '{"error":"Нет доступа"}' }] });
  const result = await agent.ask({ message: 'Услуги' });
  assert.equal(result.toolCalls[0].status, 'error'); assert.match(requests[1].input.at(-1).output, /Нет доступа/);
});
test('stops at five actual tool calls and disables tools for final answer', async () => {
  const { agent, requests, executed } = setup([{ output: [call()] }]);
  const result = await agent.ask({ message: 'Услуги' });
  assert.equal(executed.length, 5); assert.equal(requests.length, 6); assert.equal(requests.at(-1).tool_choice, 'none');
  assert.match(result.answer, /лимит/);
});

test('a batch of tool calls cannot exceed five MCP executions', async () => {
  const { agent, executed, requests } = setup([{ output: Array.from({ length: 7 }, (_, i) => ({ ...call(), call_id: `batch-${i}` })) }, { output: [], output_text: 'Done' }]);
  const result = await agent.ask({ message: 'Услуги' });
  assert.equal(executed.length, 5);
  assert.equal(result.toolCalls.filter(item => item.status === 'success').length, 5);
  assert.equal(requests[1].input.filter(item => item.type === 'function_call_output').length, 7);
});
test('missing configuration and failed model requests never expose credentials', async () => {
  await assert.rejects(new LlmAgent().ask({ message: 'Hi' }), /OPENAI_API_KEY/);
  const { agent } = setup([]);
  agent.client.responses.create = async () => { throw new Error('SECRET_API_KEY'); };
  await assert.rejects(agent.ask({ message: 'Hi' }), error => !error.message.includes('SECRET_API_KEY'));
});
test('preserves tool trace if final model request fails', async () => {
  const { agent } = setup([{ output: [call()] }]);
  let count = 0;
  agent.client.responses.create = async () => {
    if (++count === 1) return { output: [call()] };
    throw new Error('SECRET');
  };
  const result = await agent.ask({ message: 'Услуги' });
  assert.equal(result.toolCalls.length, 1);
  assert.match(result.answer, /не смогла/);
  assert.doesNotMatch(JSON.stringify(result), /SECRET/);
});
