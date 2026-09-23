import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'day-16-demo', version: '1.0.0' });

server.registerTool('echo', {
  description: 'Возвращает переданный текст.',
  inputSchema: { text: z.string().describe('Текст для повтора') },
}, async ({ text }) => ({ content: [{ type: 'text', text }] }));

server.registerTool('add', {
  description: 'Складывает два числа.',
  inputSchema: { a: z.number(), b: z.number() },
}, async ({ a, b }) => ({ content: [{ type: 'text', text: String(a + b) }] }));

// stdout is reserved for MCP JSON-RPC messages.
await server.connect(new StdioServerTransport());
