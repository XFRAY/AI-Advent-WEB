import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { listMcpTools } from './client.js';

const execFileAsync = promisify(execFile);
const clientPath = fileURLToPath(new URL('./client.js', import.meta.url));

test('MCP connects over stdio and returns tool descriptions and schemas', { timeout: 15_000 }, async () => {
  const tools = await listMcpTools();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), ['add', 'echo']);
  for (const tool of tools) {
    assert.ok(tool.description.length > 0);
    assert.equal(tool.inputSchema.type, 'object');
  }
  const echo = tools.find((tool) => tool.name === 'echo');
  assert.equal(echo.inputSchema.properties.text.type, 'string');
  assert.deepEqual(echo.inputSchema.required, ['text']);
  const add = tools.find((tool) => tool.name === 'add');
  assert.equal(add.inputSchema.properties.a.type, 'number');
  assert.equal(add.inputSchema.properties.b.type, 'number');
  assert.deepEqual(add.inputSchema.required.sort(), ['a', 'b']);
});

test('CLI prints tools and exits after closing its transport', async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, [clientPath], { timeout: 15_000 });
  assert.equal(stderr, '');
  assert.match(stdout, /MCP-соединение установлено/);
  assert.match(stdout, /Доступно инструментов: 2/);
  const tools = JSON.parse(stdout.slice(stdout.indexOf('[')));
  assert.deepEqual(tools.map((tool) => tool.name).sort(), ['add', 'echo']);
});

test('CLI reports a missing server and exits unsuccessfully without hanging', async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [clientPath, `${clientPath}.missing`], { timeout: 15_000 }),
    (error) => {
      assert.equal(error.code, 1);
      assert.equal(error.killed, false);
      assert.match(error.stderr, /Ошибка MCP:/);
      assert.doesNotMatch(error.stdout, /соединение установлено/);
      return true;
    },
  );
});
