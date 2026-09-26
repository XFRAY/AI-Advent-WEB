import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { AltegioApi, AltegioError } from './altegio.js';
import { pipelineTools } from '../pipeline/tools.js';
import { PipelineError, summarizeServices, toSearchResult } from '../pipeline/summarize.js';
import { defaultReportsDir, saveReport } from '../pipeline/files.js';

export function createMcpServer({ api = new AltegioApi(), reportsDir = defaultReportsDir() } = {}) {
  const server = new McpServer({ name: 'day-19-altegio', version: '1.0.0' });
  const pipeline = {
    pipeline_search: async args => toSearchResult(await api.listServices(args)),
    pipeline_summarize: async ({ source }) => summarizeServices(source),
    pipeline_save_to_file: args => saveReport({ dir: reportsDir, ...args }),
  };
  for (const [name, definition] of Object.entries(pipelineTools)) server.registerTool(name, {
    description: definition.description, inputSchema: definition.schema.shape,
    annotations: { readOnlyHint: name !== 'pipeline_save_to_file', destructiveHint: false, openWorldHint: name === 'pipeline_search' },
  }, async args => {
    try { const result = await pipeline[name](args); return { structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result) }] }; }
    catch (error) { return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: error instanceof PipelineError || error instanceof AltegioError ? error.message : 'Ошибка шага пайплайна.' }) }] }; }
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // stdout is reserved for the MCP protocol. Never log credentials.
  await createMcpServer().connect(new StdioServerTransport());
}
