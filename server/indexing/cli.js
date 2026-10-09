import 'dotenv/config';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { buildIndex } from './pipeline.js';
import { createOllamaEmbedder } from './embeddings.js';
import { createOllamaClient } from '../ollama.js';

export async function runCli({ embedder, indexesDir, manifestPath, output = console } = {}) {
  const result = await buildIndex({ embedder: embedder ?? createOllamaEmbedder({ client: createOllamaClient() }), indexesDir, manifestPath });
  const item = result.index;
  output.table([{ strategy: item.strategy, documents: item.stats.documents, chunks: item.stats.chunks, avg_tokens: item.stats.average_tokens,
    min_tokens: item.stats.min_tokens, max_tokens: item.stats.max_tokens, duration_ms: item.stats.duration_ms, bytes: (await fs.stat(item.file)).size }]);
  output.log(`Корпус: ${result.corpus.documents} документов, ~${result.corpus.estimatedPages} стр., ${result.corpus.tokens} токенов.`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await runCli(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
