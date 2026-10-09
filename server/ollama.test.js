import test from 'node:test';
import assert from 'node:assert/strict';
import { createOllamaClient } from './ollama.js';
import { createOllamaEmbedder } from './indexing/embeddings.js';

function response(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }); }

test('Ollama client reports models and sends embedding batches', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    if (url.endsWith('/api/version')) return response({ version: '0.12.6' });
    if (url.endsWith('/api/tags')) return response({ models: [{ name: 'qwen3:1.7b' }, { name: 'embeddinggemma:latest' }] });
    calls.push(JSON.parse(options.body)); return response({ embeddings: [[1, 0], [0, 1]] });
  };
  const client = createOllamaClient({ fetchImpl }); const status = await client.status(['qwen3:1.7b', 'embeddinggemma']);
  assert.deepEqual(status.models, { 'qwen3:1.7b': true, embeddinggemma: true });
  const embedder = createOllamaEmbedder({ client }); assert.deepEqual(await embedder.embed(['a', 'b']), [[1, 0], [0, 1]]); assert.equal(calls[0].model, 'embeddinggemma');
});

test('Ollama client maps network and malformed embedding failures', async () => {
  const unavailable = createOllamaClient({ fetchImpl: async () => { throw new Error('offline'); } });
  await assert.rejects(unavailable.status([]), error => error.code === 'OLLAMA_UNAVAILABLE');
  const malformed = createOllamaClient({ fetchImpl: async () => response({ embeddings: [] }) });
  await assert.rejects(malformed.embed(['x']), /некорректные embeddings/);
});
