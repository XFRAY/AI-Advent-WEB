import 'dotenv/config';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { buildIndexes } from './pipeline.js';
import { createOpenAIEmbedder } from './embeddings.js';

export async function runCli({ argv = process.argv.slice(2), embedder, indexesDir, manifestPath, output = console } = {}) {
  const valueIndex = argv.indexOf('--strategy');
  const strategy = valueIndex >= 0 ? argv[valueIndex + 1] : 'all';
  const result = await buildIndexes({ strategy, embedder: embedder ?? createOpenAIEmbedder(), indexesDir, manifestPath });
  const rows = await Promise.all(result.indexes.map(async item => ({
    strategy: item.strategy,
    documents: item.stats.documents,
    chunks: item.stats.chunks,
    avg_tokens: item.stats.average_tokens,
    min_tokens: item.stats.min_tokens,
    max_tokens: item.stats.max_tokens,
    duration_ms: item.stats.duration_ms,
    bytes: (await fs.stat(item.file)).size,
  })));
  output.table(rows);
  output.log(`Корпус: ${result.corpus.documents} документов, ~${result.corpus.estimatedPages} стр., ${result.corpus.tokens} токенов.`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await runCli(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
