import OpenAI from 'openai';

export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';

export class EmbeddingConfigurationError extends Error {}

export function createOpenAIEmbedder({ apiKey = process.env.OPENAI_API_KEY, model = process.env.OPENAI_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL, client } = {}) {
  if (!client && !apiKey) throw new EmbeddingConfigurationError('Задайте OPENAI_API_KEY для построения индекса и поиска.');
  const openai = client ?? new OpenAI({ apiKey });
  return {
    model,
    async embed(texts) {
      if (!Array.isArray(texts) || !texts.length) return [];
      const response = await openai.embeddings.create({ model, input: texts, encoding_format: 'float' });
      return response.data.sort((a, b) => a.index - b.index).map(item => item.embedding);
    },
  };
}

export async function embedBatches(texts, embedder, batchSize = 64) {
  const vectors = [];
  for (let offset = 0; offset < texts.length; offset += batchSize) vectors.push(...await embedder.embed(texts.slice(offset, offset + batchSize)));
  if (vectors.length !== texts.length) throw new Error('Провайдер embeddings вернул неожиданное число векторов.');
  return vectors;
}
