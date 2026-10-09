import fs from 'node:fs/promises';
import path from 'node:path';
import { projectRoot } from './corpus.js';

export const INDEX_SCHEMA_VERSION = 1;
export const defaultIndexesDir = path.join(projectRoot, 'data', 'indexes');

export function indexPath(directory = defaultIndexesDir) {
  return path.join(directory, 'structured.json');
}

export function validateIndex(index) {
  if (!index || index.schema_version !== INDEX_SCHEMA_VERSION || index.strategy !== 'structured' || !Array.isArray(index.chunks)) throw new Error('Structured-индекс отсутствует или несовместим.');
  if (!index.embedding?.model || !Number.isInteger(index.embedding.dimension)) throw new Error('Structured-индекс не содержит корректных данных embeddings.');
  for (const chunk of index.chunks) if (!Array.isArray(chunk.embedding) || chunk.embedding.length !== index.embedding.dimension) throw new Error('Structured-индекс повреждён.');
  return index;
}

export async function writeIndexAtomic(index, directory = defaultIndexesDir) {
  await fs.mkdir(directory, { recursive: true });
  const destination = indexPath(directory);
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(index));
    await fs.rename(temporary, destination);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
  return destination;
}

export async function readIndex(directory = defaultIndexesDir) {
  return validateIndex(JSON.parse(await fs.readFile(indexPath(directory), 'utf8')));
}

export async function readIndexSummary(directory = defaultIndexesDir) {
  try {
    const index = await readIndex(directory);
    const stat = await fs.stat(indexPath(directory));
    return { available: true, strategy: 'structured', manifest: { ...index.manifest, embedding: index.embedding, stats: index.stats }, bytes: stat.size };
  } catch (error) {
    return { available: false, strategy: 'structured', error: error.code === 'ENOENT' ? null : error.message };
  }
}
