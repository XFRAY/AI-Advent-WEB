import { performance } from 'node:perf_hooks';
import { CHUNKING, chunkDocuments } from './chunking.js';
import { loadCorpus } from './corpus.js';
import { embedBatches } from './embeddings.js';
import { INDEX_SCHEMA_VERSION, writeIndexAtomic } from './store.js';

export const STRATEGIES = ['fixed', 'structured'];

export async function buildIndexes({ strategy = 'all', embedder, indexesDir, manifestPath } = {}) {
  const strategies = strategy === 'all' ? STRATEGIES : [strategy];
  if (!strategies.every(item => STRATEGIES.includes(item))) throw new TypeError('strategy должна быть all, fixed или structured.');
  if (!embedder) throw new TypeError('Не задан провайдер embeddings.');
  const corpus = await loadCorpus({ manifestPath });
  const pending = [];
  for (const current of strategies) {
    const started = performance.now();
    const chunks = chunkDocuments(corpus.documents, current);
    const vectors = await embedBatches(chunks.map(chunk => chunk.text), embedder);
    const counts = chunks.map(chunk => chunk.metadata.token_count);
    const stats = {
      documents: corpus.documents.length,
      chunks: chunks.length,
      min_tokens: Math.min(...counts),
      max_tokens: Math.max(...counts),
      average_tokens: Number((counts.reduce((sum, value) => sum + value, 0) / counts.length).toFixed(1)),
      duration_ms: Math.round(performance.now() - started),
    };
    const index = {
      schema_version: INDEX_SCHEMA_VERSION,
      strategy: current,
      created_at: new Date().toISOString(),
      embedding: { model: embedder.model, dimension: vectors[0]?.length ?? 0 },
      manifest: { corpus: corpus.stats, chunking: CHUNKING[current] },
      stats,
      chunks: chunks.map((chunk, index) => ({ ...chunk, embedding: vectors[index] })),
    };
    pending.push({ index, stats });
  }
  const results = await Promise.all(pending.map(async ({ index, stats }) => ({ strategy: index.strategy, file: await writeIndexAtomic(index, indexesDir), stats, embedding: index.embedding })));
  return { corpus: corpus.stats, indexes: results };
}
