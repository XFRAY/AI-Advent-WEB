export const DEFAULT_EMBEDDING_MODEL = 'embeddinggemma';

export class EmbeddingConfigurationError extends Error {}

export function createOllamaEmbedder({ client, model = process.env.OLLAMA_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL } = {}) {
  if (!client?.embed) throw new EmbeddingConfigurationError('Не настроен локальный клиент Ollama.');
  return {
    model,
    async embed(texts) {
      if (!Array.isArray(texts) || !texts.length) return [];
      return client.embed(texts, model);
    },
  };
}

export async function embedBatches(texts, embedder, batchSize = 64) {
  const vectors = [];
  for (let offset = 0; offset < texts.length; offset += batchSize) vectors.push(...await embedder.embed(texts.slice(offset, offset + batchSize)));
  if (vectors.length !== texts.length) throw new Error('Провайдер embeddings вернул неожиданное число векторов.');
  return vectors;
}
