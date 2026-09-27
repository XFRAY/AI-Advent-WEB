import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

// Errors with messages that are safe to show to the model and the user.
export class ToolError extends Error {}

// Every server registers tools the same way: structured result or a safe error text.
export function createToolServer({ name, definitions, handlers }) {
  const server = new McpServer({ name, version: '1.0.0' });
  for (const [tool, definition] of Object.entries(definitions)) server.registerTool(tool, {
    description: definition.description, inputSchema: definition.schema.shape, annotations: definition.annotations,
  }, async args => {
    try {
      const result = await handlers[tool](args);
      return { structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: error instanceof ToolError ? error.message : 'Ошибка инструмента.' }) }] };
    }
  });
  return server;
}

export const isMain = meta => Boolean(process.argv[1]) && meta.url === pathToFileURL(process.argv[1]).href;
// stdout is reserved for the MCP protocol. Never log credentials.
export const serveStdio = server => server.connect(new StdioServerTransport());
