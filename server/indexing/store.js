import fs from 'node:fs/promises';
import path from 'node:path';
import { projectRoot } from './corpus.js';

export const INDEX_SCHEMA_VERSION = 1;
export const defaultIndexesDir = path.join(projectRoot, 'data', 'indexes');

export function indexPath(strategy, directory = defaultIndexesDir) {
  return path.join(directory, `${strategy}.json`);
}

export function validateIndex(index, expectedStrategy) {
  if (!index || index.schema_version !== INDEX_SCHEMA_VERSION || index.strategy !== expectedStrategy || !Array.isArray(index.chunks)) throw new Error(`Индекс ${expectedStrategy} отсутствует или несовместим.`);
  if (!index.embedding?.model || !Number.isInteger(index.embedding.dimension)) throw new Error(`Индекс ${expectedStrategy} не содержит корректных данных embeddings.`);
  for (const chunk of index.chunks) if (!Array.isArray(chunk.embedding) || chunk.embedding.length !== index.embedding.dimension) throw new Error(`Индекс ${expectedStrategy} повреждён.`);
  return index;
}

export async function writeIndexAtomic(index, directory = defaultIndexesDir) {
  await fs.mkdir(directory, { recursive: true });
  const destination = indexPath(index.strategy, directory);
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

export async function readIndex(strategy, directory = defaultIndexesDir) {
  return validateIndex(JSON.parse(await fs.readFile(indexPath(strategy, directory), 'utf8')), strategy);
}

export async function readIndexSummary(strategy, directory = defaultIndexesDir) {
  try {
    const index = await readIndex(strategy, directory);
    const stat = await fs.stat(indexPath(strategy, directory));
    return { available: true, strategy, manifest: { ...index.manifest, embedding: index.embedding, stats: index.stats }, bytes: stat.size };
  } catch (error) {
    return { available: false, strategy, error: error.code === 'ENOENT' ? null : error.message };
  }
}

export async function deleteIndexes(strategies, directory = defaultIndexesDir) {
  const removed = [];
  for (const strategy of strategies) {
    try { await fs.unlink(indexPath(strategy, directory)); removed.push(strategy); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return removed;
}
