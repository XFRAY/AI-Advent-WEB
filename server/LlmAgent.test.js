import test from 'node:test';
import assert from 'node:assert/strict';
import { LlmAgent } from './LlmAgent.js';
import { McpCallError } from './mcp/connection.js';
const call = (name, args = {}, id = name) => ({ type: 'function_call', name, arguments: typeof args === 'string' ? args : JSON.stringify(args), call_id: id });
const ok = value => ({ structuredContent: value });
const tools = [['altegio', 'altegio_search_services'], ['analytics', 'analytics_price_stats'], ['currency', 'currency_convert'], ['files', 'files_save_report'], ['files', 'files_list_reports']]
  .map(([server, name]) => ({ server, name, description: name, inputSchema: { $schema: 'x', type: 'object' } }));
// Registry stub: records which tool was routed with which arguments.
function setup(respond, handlers = {}) {
  const requests = [], executed = [];
  const defaults = {
    altegio_search_services: () => ok({ services: [{ id: '1', title: 'Стрижка', price_min: 50, price_max: 70, currency: 'PLN' }], truncated: false }),
    analytics_price_stats: args => ok({ count: args.items.length, text: 'Услуг: 1' }),
    currency_convert: args => ok({ from: args.from, to: args.to, rate: 0.25, amounts: args.amounts.map(amount => ({ amount, converted: amount / 4 })) }),
    files_save_report: () => ok({ file: 'report-1.md' }),
    files_list_reports: () => ok({ reports: [{ file: 'report-1.md' }] }),
    ...handlers,
  };
  const mcp = { listTools: async () => tools, callTool: async (name, args) => { executed.push([name, args]); return defaults[name](args); } };
  const client = { responses: { create: async request => { requests.push(structuredClone(request)); return respond(request, requests.length); } } };
  return { agent: new LlmAgent({ client, mcp }), requests, executed, mcp };
}
const lastOutput = request => JSON.parse(request.input.findLast(item => item.type === 'function_call_output').output);

test('the model drives a five-step flow across four servers, one call at a time', async () => {
  // Scripted model: each step is built from the previous tool output it received.
  const { agent, requests, executed } = setup((request, n) => {
    if (n === 1) return { output: [call('altegio_search_services', { query: 'стрижка' })] };
    const previous = lastOutput(request);
    if (n === 2) return { output: [call('analytics_price_stats', { items: previous.services })] };
    if (n === 3) return { output: [call('currency_convert', { from: 'PLN', to: 'EUR', amounts: [50, 70] })] };
    if (n === 4) return { output: [call('files_save_report', { title: 'Стрижки', markdown: `50 PLN = ${previous.amounts[0].converted} EUR` })] };
    if (n === 5) return { output: [call('files_list_reports')] };
    return { output: [], output_text: `Готово: ${previous.reports[0].file}` };
  });
  const result = await agent.ask({ message: 'Стрижки в EUR, сохрани и покажи отчёты', history: [{ role: 'user', text: 'Привет' }, { role: 'agent', text: 'Здравствуйте' }] });
  assert.deepEqual(result.toolCalls.map(item => [item.step, item.server, item.name, item.status]), [
    [1, 'altegio', 'altegio_search_services', 'success'], [2, 'analytics', 'analytics_price_stats', 'success'],
    [3, 'currency', 'currency_convert', 'success'], [4, 'files', 'files_save_report', 'success'], [5, 'files', 'files_list_reports', 'success'],
  ]);
  assert.equal(executed[1][1].items[0].title, 'Стрижка');
  assert.equal(executed[3][1].markdown, '50 PLN = 12.5 EUR');
  assert.equal(result.answer, 'Готово: report-1.md');
  assert.deepEqual(requests[0].tools.map(tool => tool.name), tools.map(tool => tool.name));
  assert.match(requests[0].tools[2].description, /^\[MCP-сервер currency\]/);
  assert.equal(requests[0].tools[0].parameters.$schema, undefined);
  assert.equal(requests[0].parallel_tool_calls, false);
  assert.deepEqual(requests[0].input.map(item => item.role), ['user', 'assistant', 'user']);
});
test('ordinary conversation does not call MCP tools', async () => {
  const { agent, executed } = setup(() => ({ output: [], output_text: 'Привет!' }));
  assert.equal((await agent.ask({ message: 'Привет' })).answer, 'Привет!'); assert.equal(executed.length, 0);
});
test('unknown tools, invalid JSON and rejected arguments are traced as errors and reported to the model', async () => {
  const cases = [[call('pipeline_search'), /Неизвестный/, null], [call('currency_convert', '{'), /JSON/, 'currency']];
  for (const [item, pattern, server] of cases) {
    const { agent, executed, requests } = setup((_request, n) => n === 1 ? { output: [item] } : { output: [], output_text: 'Ошибка.' });
    const result = await agent.ask({ message: 'x' });
    assert.equal(executed.length, 0); assert.deepEqual([result.toolCalls[0].status, result.toolCalls[0].server], ['error', server]);
    assert.match(lastOutput(requests[1]).error, pattern);
  }
  const { agent, requests } = setup((_request, n) => n === 1 ? { output: [call('currency_convert', {})] } : { output: [], output_text: 'x' },
    { currency_convert: () => { throw new McpCallError('Некорректные аргументы инструмента: from — Required.'); } });
  await agent.ask({ message: 'x' });
  assert.match(lastOutput(requests[1]).error, /from — Required/);
});
test('a tool error from a server is returned to the model and the trace keeps the server', async () => {
  const { agent, requests } = setup((_request, n) => n === 1 ? { output: [call('altegio_search_services')] } : { output: [], output_text: 'Нет доступа.' },
    { altegio_search_services: () => ({ isError: true, content: [{ type: 'text', text: '{"error":"Altegio: нет доступа"}' }] }) });
  const result = await agent.ask({ message: 'Услуги' });
  assert.deepEqual([result.toolCalls[0].server, result.toolCalls[0].status, result.toolCalls[0].result.error], ['altegio', 'error', 'Altegio: нет доступа']);
  assert.deepEqual(lastOutput(requests[1]), { error: 'Altegio: нет доступа' });
});
test('stops after twelve tool calls and disables tools for the final answer', async () => {
  const { agent, requests, executed } = setup(() => ({ output: [call('files_list_reports', {}, 'a'), call('files_list_reports', {}, 'b'), call('files_list_reports', {}, 'c'), call('files_list_reports', {}, 'd'), call('files_list_reports', {}, 'e')] }));
  const result = await agent.ask({ message: 'x' });
  assert.equal(executed.length, 12); assert.equal(result.toolCalls.length, 12);
  assert.equal(requests.at(-1).tool_choice, 'none'); assert.match(result.answer, /лимит 12/);
  // Every call in a batch gets an output, even past the limit.
  assert.equal(requests.at(-1).input.filter(item => item.type === 'function_call_output').length, 15);
});
test('configuration, unavailable servers and failed model requests never expose secrets', async () => {
  await assert.rejects(new LlmAgent().ask({ message: 'Hi' }), /OPENAI_API_KEY/);
  const { agent, mcp } = setup(() => { throw new Error('SECRET_API_KEY'); });
  await assert.rejects(agent.ask({ message: 'Hi' }), error => !error.message.includes('SECRET'));
  agent.client.responses.create = async () => { throw Object.assign(new Error('SECRET quota'), { status: 429 }); };
  await assert.rejects(agent.ask({ message: 'Hi' }), error => /кредиты/.test(error.message) && !error.message.includes('SECRET'));
  mcp.listTools = async () => [];
  await assert.rejects(agent.ask({ message: 'Hi' }), /Ни один MCP-сервер/);
  mcp.listTools = async () => { throw new Error('SECRET'); };
  await assert.rejects(agent.ask({ message: 'Hi' }), error => /недоступны/.test(error.message));
});
test('unexpected call failures are hidden and the trace survives a failed final model request', async () => {
  const { agent } = setup((_request, n) => { if (n === 1) return { output: [call('altegio_search_services')] }; throw new Error('SECRET'); },
    { altegio_search_services: () => { throw new Error('SECRET_TOKEN'); } });
  const result = await agent.ask({ message: 'Услуги' });
  assert.equal(result.toolCalls.length, 1); assert.equal(result.toolCalls[0].result.error, 'Не удалось вызвать инструмент.');
  assert.match(result.answer, /не смогла/); assert.doesNotMatch(JSON.stringify(result), /SECRET/);
});
