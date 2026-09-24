import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { AltegioApi, AltegioError, TOOL_NAME, inputShape, description } from './altegio.js';

export function createMcpServer({ api = new AltegioApi() } = {}) {
  const server = new McpServer({ name: 'day-17-altegio', version: '1.0.0' });
  server.registerTool(TOOL_NAME, {
    description, inputSchema: inputShape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (args) => {
    try {
      const result = await api.listServices(args);
      return { structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (error) {
      const result = { error: error instanceof AltegioError ? error.message : 'Не удалось получить услуги Altegio.' };
      return { isError: true, content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // stdout is reserved for the MCP protocol. Never log credentials.
  await createMcpServer().connect(new StdioServerTransport());
}
