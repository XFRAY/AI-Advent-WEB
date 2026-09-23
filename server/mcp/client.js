import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const defaultServerPath = fileURLToPath(new URL('./server.js', import.meta.url));

export async function listMcpTools({ serverPath = defaultServerPath, timeoutMs = 10_000 } = {}) {
  const client = new Client({ name: 'day-16-client', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    stderr: 'inherit',
  });

  try {
    await client.connect(transport, { timeout: timeoutMs });
    const tools = [];
    let cursor;
    const deadline = Date.now() + timeoutMs;
    do {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('Превышено время ожидания списка инструментов');
      const page = await client.listTools(cursor ? { cursor } : {}, { timeout: remaining });
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);
    return tools;
  } finally {
    await client.close();
    await transport.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const tools = await listMcpTools({ serverPath: process.argv[2] });
    console.log('MCP-соединение установлено.');
    console.log(`Доступно инструментов: ${tools.length}`);
    console.log(JSON.stringify(tools.map(({ name, description, inputSchema }) => ({
      name, description, inputSchema,
    })), null, 2));
  } catch (error) {
    console.error(`Ошибка MCP: ${error.message}`);
    process.exitCode = 1;
  }
}
