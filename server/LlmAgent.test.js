import test from 'node:test';
import assert from 'node:assert/strict';
import { LlmAgent } from './LlmAgent.js';
import { summarizeServices, toSearchResult } from './pipeline/summarize.js';
const call = (args = '{}', name = 'services_report') => ({ type: 'function_call', name, arguments: args, call_id: 'call-1' });
const ok = value => ({ structuredContent: value });
// MCP stub with the real step logic, so data passed between steps is actually verified.
function setup(responses, { failSearch = false } = {}) {
  const requests = [], executed = [];
  const tools = ['pipeline_search', 'pipeline_summarize', 'pipeline_save_to_file'].map(name => ({ name, inputSchema: { type: 'object' } }));
  const handlers = {
    pipeline_search: args => failSearch ? { isError: true, content: [{ type: 'text', text: '{"error":"Нет доступа"}' }] } : ok(toSearchResult({ query: args.query, services: [{ id: '1', title: 'Стрижка', price_min: 50, price_max: 70, currency: 'PLN' }] })),
    pipeline_summarize: args => ok(summarizeServices(args.source)),
    pipeline_save_to_file: args => ok({ file: 'services-1.md', format: 'md', bytes: 1, reportChecksum: args.report.checksum, savedAt: new Date().toISOString() }),
  };
  const mcp = { listTools: async () => tools, callTool: async (name, args) => { executed.push([name, args]); return handlers[name](args); } };
  const client = { responses: { create: async request => { requests.push(structuredClone(request)); return responses[Math.min(requests.length - 1, responses.length - 1)]; } } };
  return { agent: new LlmAgent({ client, mcp }), requests, executed, mcp };
}
test('one model call runs the whole MCP chain and always saves the file', async () => {
  const reasoning = { type: 'reasoning', id: 'r1', summary: [], encrypted_content: 'encrypted' };
  const { agent, requests, executed } = setup([{ output: [reasoning, call('{"query":"стрижка"}')] }, { output: [], output_text: 'Стрижка — от 50. Отчёт: services-1.md' }]);
  const result = await agent.ask({ message: 'Какие стрижки?', history: [{ role: 'user', text: 'Привет' }, { role: 'agent', text: 'Здравствуйте' }] });
  assert.deepEqual(executed.map(([name]) => name), ['pipeline_search', 'pipeline_summarize', 'pipeline_save_to_file']);
  const [[, search], [, summarize], [, save]] = executed;
  assert.deepEqual(search, { query: 'стрижка', limit: 50 });
  assert.equal(summarize.source.query, 'стрижка'); assert.equal(summarize.source.items[0].title, 'Стрижка');
  assert.equal(save.report.sourceChecksum, summarize.source.checksum); assert.equal(save.format, 'md');
  assert.deepEqual(requests[0].tools.map(tool => tool.name), ['services_report']);
  assert.ok(requests[1].input.some(item => item.type === 'reasoning'));
  const output = JSON.parse(requests[1].input.find(item => item.type === 'function_call_output').output);
  assert.equal(output.status, 'success'); assert.equal(output.file, 'services-1.md'); assert.equal(output.report.byCurrency[0].priceMin, 50);
  assert.deepEqual(result.toolCalls.map(item => [item.name, item.status]), [['pipeline_search', 'success'], ['pipeline_summarize', 'success'], ['pipeline_save_to_file', 'success']]);
  assert.equal(result.toolCalls[2].result.file, 'services-1.md');
});
test('ordinary conversation does not call MCP tools', async () => {
  const { agent, executed } = setup([{ output: [], output_text: 'Привет!' }]);
  assert.equal((await agent.ask({ message: 'Привет' })).answer, 'Привет!'); assert.equal(executed.length, 0);
});
test('rejects unknown tools, invalid JSON and invalid arguments before execution', async () => {
  for (const item of [call('{'), call('{"limit":0}'), call('{}', 'pipeline_search')]) {
    const { agent, executed, requests } = setup([{ output: [item] }, { output: [], output_text: 'Ошибка инструмента.' }]);
    const result = await agent.ask({ message: 'Услуги' });
    assert.equal(executed.length, 0); assert.equal(result.toolCalls[0].status, 'error');
    assert.ok(JSON.parse(requests[1].input.at(-1).output).error);
  }
});
test('a failed step stops the chain and the model is told no file was saved', async () => {
  const { agent, requests, executed } = setup([{ output: [call()] }, { output: [], output_text: 'Нет доступа.' }], { failSearch: true });
  const result = await agent.ask({ message: 'Услуги' });
  assert.equal(executed.length, 1);
  assert.deepEqual(result.toolCalls.map(item => item.status), ['error', 'skipped', 'skipped']);
  const output = JSON.parse(requests[1].input.at(-1).output);
  assert.equal(output.status, 'error'); assert.equal(output.file, null); assert.match(output.errors[0].error, /Нет доступа/);
});
test('stops at five pipeline runs and disables tools for final answer', async () => {
  const { agent, requests, executed } = setup([{ output: [call()] }]);
  const result = await agent.ask({ message: 'Услуги' });
  assert.equal(executed.length, 15); assert.equal(requests.length, 6); assert.equal(requests.at(-1).tool_choice, 'none');
  assert.match(result.answer, /лимит/);
});
test('a batch of tool calls cannot exceed five pipeline runs', async () => {
  const { agent, executed, requests } = setup([{ output: Array.from({ length: 7 }, (_, i) => ({ ...call(), call_id: `batch-${i}` })) }, { output: [], output_text: 'Done' }]);
  await agent.ask({ message: 'Услуги' });
  assert.equal(executed.length, 15);
  assert.equal(requests[1].input.filter(item => item.type === 'function_call_output').length, 7);
});
test('missing pipeline tools, configuration and failed model requests never expose credentials', async () => {
  await assert.rejects(new LlmAgent().ask({ message: 'Hi' }), /OPENAI_API_KEY/);
  const { agent, mcp } = setup([]);
  agent.client.responses.create = async () => { throw new Error('SECRET_API_KEY'); };
  await assert.rejects(agent.ask({ message: 'Hi' }), error => !error.message.includes('SECRET_API_KEY'));
  agent.client.responses.create = async () => { throw Object.assign(new Error('SECRET quota'), { status: 429 }); };
  await assert.rejects(agent.ask({ message: 'Hi' }), error => /кредиты/.test(error.message) && !error.message.includes('SECRET'));
  mcp.listTools = async () => [{ name: 'pipeline_search' }];
  await assert.rejects(agent.ask({ message: 'Hi' }), /пайплайна не зарегистрированы/);
});
test('preserves tool trace if final model request fails', async () => {
  const { agent } = setup([]);
  let count = 0;
  agent.client.responses.create = async () => {
    if (++count === 1) return { output: [call()] };
    throw new Error('SECRET');
  };
  const result = await agent.ask({ message: 'Услуги' });
  assert.equal(result.toolCalls.length, 3);
  assert.match(result.answer, /не смогла/);
  assert.doesNotMatch(JSON.stringify(result), /SECRET/);
});
