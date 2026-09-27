import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from './index.js';
import { LlmAgent } from './LlmAgent.js';
import { McpRegistry } from './mcp/registry.js';
import { testServers } from './testing/servers.js';

// Scripted model: it only sees tool definitions and tool outputs, like a real one; every call goes through the registry.
function scriptedModel() {
  const seen = [];
  const create = async request => {
    seen.push(request.tools.map(tool => tool.name));
    const outputs = request.input.filter(item => item.type === 'function_call_output').map(item => JSON.parse(item.output));
    const last = outputs.at(-1);
    const next = (name, args) => ({ output: [{ type: 'function_call', name, arguments: JSON.stringify(args), call_id: `call-${outputs.length}` }] });
    switch (outputs.length) {
      case 0: return next('altegio_search_services', { query: 'Стрижка' });
      case 1: return next('analytics_price_stats', { items: last.services });
      case 2: return next('currency_convert', { from: last.byCurrency[0].currency, to: 'EUR', amounts: outputs[0].services.map(item => item.price_min ?? 0) });
      case 3: {
        const [search, stats] = outputs;
        const rows = search.services.map((item, index) => `| ${item.title} | ${item.price_min ?? '—'} | ${last.amounts[index].converted} |`);
        return next('files_save_report', { title: 'Стрижки в EUR', name: 'haircuts-eur', markdown: [stats.text, '', `Курс ${last.from}→${last.to}: ${last.rate} (${last.rateDate})`, '', '| Услуга | PLN | EUR |', '|---|---|---|', ...rows].join('\n') });
      }
      case 4: return next('files_list_reports', {});
      case 5: return next('files_read_report', { file: last.reports[0].file });
      default: return { output: [], output_text: `Отчёт ${outputs[3].file} сохранён.` };
    }
  };
  return { client: { responses: { create } }, seen };
}

test('one chat request runs a long flow over four MCP servers in the correct order', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'orchestration-'));
  const mcp = new McpRegistry({ env: { REPORTS_DIR: dir }, servers: testServers() });
  const model = scriptedModel();
  const app = createApp({ mcp, agent: new LlmAgent({ mcp, client: model.client }) });
  await app.locals.start();
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await app.locals.close(); await rm(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}/api`;

  const servers = (await (await fetch(`${base}/mcp/servers`)).json()).servers;
  assert.deepEqual(servers.map(item => [item.name, item.connected, item.tools.length]), [['altegio', true, 1], ['analytics', true, 1], ['currency', true, 1], ['files', true, 3]]);

  const response = await fetch(`${base}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Найди стрижки, посчитай цены, переведи в EUR, сохрани отчёт и покажи его' }) });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(model.seen[0].length, 6);
  assert.deepEqual(body.toolCalls.map(call => [call.step, call.server, call.name, call.status]), [
    [1, 'altegio', 'altegio_search_services', 'success'],
    [2, 'analytics', 'analytics_price_stats', 'success'],
    [3, 'currency', 'currency_convert', 'success'],
    [4, 'files', 'files_save_report', 'success'],
    [5, 'files', 'files_list_reports', 'success'],
    [6, 'files', 'files_read_report', 'success'],
  ]);
  const [search, stats, converted, saved, , read] = body.toolCalls.map(call => call.result);
  assert.deepEqual(search.services.map(item => item.id), ['1', '2', '4']);
  assert.deepEqual([stats.count, stats.priced, stats.byCurrency[0].priceMin, stats.byCurrency[0].priceMax], [3, 2, 30, 70]);
  assert.deepEqual(converted.amounts.map(item => item.converted), [11.76, 7.06, 0]);
  assert.equal(body.answer, `Отчёт ${saved.file} сохранён.`);
  const content = await readFile(join(dir, 'haircuts-eur.md'), 'utf8');
  assert.equal(read.content, content);
  assert.match(content, /^# Стрижки в EUR/); assert.match(content, /Стрижка мужская \| 50 \| 11.76/); assert.match(content, /Курс PLN→EUR: 0.235294 \(2026-09-25\)/);
  assert.deepEqual(await readdir(dir), ['haircuts-eur.md']);

  const link = await fetch(`${base}/reports/haircuts-eur.md`);
  assert.equal(link.status, 200); assert.equal(await link.text(), content);
  for (const bad of ['..%2F..%2Fpackage.json', '.hidden.md', 'color.json']) assert.equal((await fetch(`${base}/reports/${bad}`)).status, 400);
  assert.equal((await fetch(`${base}/reports/missing.md`)).status, 404);
});
