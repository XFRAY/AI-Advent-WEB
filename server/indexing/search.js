import { readIndex } from './store.js';

export function cosineSimilarity(left, right) {
  if (left.length !== right.length || !left.length) return 0;
  let dot = 0; let leftNorm = 0; let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) { dot += left[index] * right[index]; leftNorm += left[index] ** 2; rightNorm += right[index] ** 2; }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}

export async function searchIndex({ query, topK = 3, embedder, indexesDir } = {}) {
  if (typeof query !== 'string' || !query.trim() || query.length > 2_000) throw new TypeError('Введите запрос от 1 до 2000 символов.');
  if (!Number.isInteger(topK) || topK < 1 || topK > 20) throw new TypeError('topK должен быть целым числом от 1 до 20.');
  const index = await readIndex(indexesDir);
  if (index.embedding.model !== embedder.model) throw new Error('Модель запроса не совпадает с моделью сохранённого индекса. Перестройте индекс.');
  const [queryVector] = await embedder.embed([query.trim()]);
  if (!Array.isArray(queryVector) || queryVector.length !== index.embedding.dimension) throw new Error('Размерность запроса не совпадает с сохранённым индексом. Перестройте индекс.');
  return {
    query: query.trim(),
    results: index.chunks.map(chunk => ({ score: cosineSimilarity(queryVector, chunk.embedding), text: chunk.text, metadata: chunk.metadata })).sort((a, b) => b.score - a.score).slice(0, topK),
  };
}
