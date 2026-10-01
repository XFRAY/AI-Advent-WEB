import { performance } from 'node:perf_hooks';
import { CHUNKING, chunkDocuments } from './chunking.js';
import { loadCorpus } from './corpus.js';
import { embedBatches } from './embeddings.js';
import { INDEX_SCHEMA_VERSION, writeIndexAtomic } from './store.js';

export async function buildIndex({ embedder, indexesDir, manifestPath } = {}) {
  if (!embedder) throw new TypeError('Не задан провайдер embeddings.');
  const corpus = await loadCorpus({ manifestPath });
  const started = performance.now();
  const chunks = chunkDocuments(corpus.documents);
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
    strategy: 'structured',
    created_at: new Date().toISOString(),
    embedding: { model: embedder.model, dimension: vectors[0]?.length ?? 0 },
    manifest: { corpus: corpus.stats, chunking: CHUNKING },
    stats,
    chunks: chunks.map((chunk, position) => ({ ...chunk, embedding: vectors[position] })),
  };
  return { corpus: corpus.stats, index: { strategy: 'structured', file: await writeIndexAtomic(index, indexesDir), stats, embedding: index.embedding } };
}
