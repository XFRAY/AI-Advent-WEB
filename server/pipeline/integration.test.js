import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { McpConnection } from '../mcp/client.js';
import { createApp } from '../index.js';
import { LlmAgent } from '../LlmAgent.js';
import { runPipeline } from './runner.js';
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'pipeline-integration-'));
  const mcp = new McpConnection({ serverPath: fileURLToPath(new URL('../testing/pipeline-mcp-fixture.js', import.meta.url)), env: { REPORTS_DIR: dir } });
  t.after(async () => { await mcp.close(); await rm(dir, { recursive: true, force: true }); });
  return { mcp, dir };
}
test('runner chains search → summarize → save over real stdio and the checksums match', async t => {
  const { mcp, dir } = await fixture(t);
  const names = (await mcp.listTools()).map(tool => tool.name);
  assert.deepEqual(names.filter(name => name.startsWith('pipeline_')), ['pipeline_search', 'pipeline_summarize', 'pipeline_save_to_file']);
  const result = await runPipeline(mcp, { query: 'стрижка', name: 'haircut' });
  assert.equal(result.status, 'success');
  assert.deepEqual(result.steps.map(step => [step.name, step.status]), [['pipeline_search', 'success'], ['pipeline_summarize', 'success'], ['pipeline_save_to_file', 'success']]);
  const [search, summary, saved] = result.steps.map(step => step.output);
  assert.deepEqual(search.items.map(item => item.id), ['1', '2', '4']);
  assert.equal(summary.sourceChecksum, search.checksum); assert.equal(saved.reportChecksum, summary.checksum);
  assert.equal(result.steps[1].input.source.checksum, search.checksum);
  assert.deepEqual([summary.count, summary.priced, summary.byCurrency[0].priceMin, summary.byCurrency[0].priceMax], [3, 2, 30, 70]);
  const markdown = await readFile(join(dir, 'haircut.md'), 'utf8');
  assert.ok(markdown.includes(summary.text)); assert.ok(markdown.includes(summary.checksum));
  assert.deepEqual(await readdir(dir), ['haircut.md']);
});
test('a failing step stops the chain and a corrupted transfer is rejected', async t => {
  const { mcp, dir } = await fixture(t);
  const failed = await runPipeline(mcp, { query: 'failure' });
  assert.equal(failed.status, 'error');
  assert.deepEqual(failed.steps.map(step => step.status), ['error', 'skipped', 'skipped']);
  assert.doesNotMatch(JSON.stringify(failed), /private-token/);
  const source = (await mcp.callTool('pipeline_search', {})).structuredContent;
  source.items[0].price_min = 1;
  const corrupted = await mcp.callTool('pipeline_summarize', { source });
  assert.equal(corrupted.isError, true); assert.match(corrupted.content[0].text, /повреждены/);
  assert.deepEqual(await readdir(dir).catch(() => []), []);
});
test('agent executes the chain itself and HTTP runs the same pipeline', async t => {
  const { mcp, dir } = await fixture(t);
  // The model makes one decision (what to search); the chain itself runs automatically.
  const create = async request => {
    const output = request.input.find(item => item.type === 'function_call_output');
    if (!output) return { output: [{ type: 'function_call', name: 'services_report', arguments: '{"query":"Окраш"}', call_id: 'call-1' }] };
    return { output: [], output_text: `Отчёт сохранён в ${JSON.parse(output.output).file}.` };
  };
  const app = createApp({ mcp, agent: new LlmAgent({ mcp, client: { responses: { create } } }) });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await app.locals.close(); });
  const request = async (path, body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/${path}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
    return { status: response.status, body: await response.json() };
  };
  const chat = await request('chat', { message: 'Сколько стоит окрашивание?' });
  const file = chat.body.toolCalls[2].result.file;
  assert.equal(chat.status, 200); assert.equal(chat.body.answer, `Отчёт сохранён в ${file}.`); assert.match(file, /^services-\d{14}\.md$/);
  assert.deepEqual(chat.body.toolCalls.map(call => [call.name, call.status]), [['pipeline_search', 'success'], ['pipeline_summarize', 'success'], ['pipeline_save_to_file', 'success']]);
  assert.match(await readFile(join(dir, file), 'utf8'), /Окрашивание \| 120 \| 200/);
  const link = await fetch(`http://127.0.0.1:${server.address().port}/api/reports/${file}`);
  assert.equal(link.status, 200); assert.match(link.headers.get('content-type'), /text\/plain; charset=utf-8/);
  assert.equal(await link.text(), await readFile(join(dir, file), 'utf8'));
  for (const bad of ['..%2F..%2Fpackage.json', '.hidden.md', 'color.txt']) assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/reports/${bad}`)).status, 400);
  assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/reports/missing.md`)).status, 404);
  const run = await request('pipeline/run', { format: 'json', name: 'all' });
  assert.equal(run.status, 200); assert.equal(run.body.status, 'success');
  assert.equal(JSON.parse(await readFile(join(dir, 'all.json'), 'utf8')).count, 4);
  assert.equal((await request('pipeline/run', { limit: 0 })).status, 400);
  assert.deepEqual((await readdir(dir)).sort(), ['all.json', file]);
});
