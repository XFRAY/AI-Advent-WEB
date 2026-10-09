import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from './parsers.js';
import { tokenCount } from './tokenizer.js';

export const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
export const defaultManifestPath = path.join(projectRoot, 'corpus', 'manifest.json');

async function listFiles(root, extensions) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.sort((a, b) => a.name.localeCompare(b.name)).map(async entry => {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) return listFiles(target, extensions);
    return extensions.includes(path.extname(entry.name).toLowerCase()) ? [target] : [];
  }));
  return nested.flat();
}

export async function loadCorpus({ manifestPath = defaultManifestPath } = {}) {
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const base = path.dirname(manifestPath);
  const specs = [];
  for (const entry of manifest.entries) {
    const target = path.resolve(base, entry.path);
    const stat = await fs.stat(target);
    const files = stat.isDirectory() ? await listFiles(target, entry.extensions ?? ['.md', '.txt']) : [target];
    for (const absolutePath of files) specs.push({ absolutePath, source: entry.source, relativePath: path.relative(projectRoot, absolutePath) });
  }
  const documents = await Promise.all(specs.map(parseDocument));
  const tokens = documents.reduce((sum, document) => sum + tokenCount(document.text), 0);
  return { documents, stats: { documents: documents.length, tokens, estimatedPages: Math.ceil(tokens / 500), types: Object.fromEntries([...new Set(documents.map(item => item.type))].map(type => [type, documents.filter(item => item.type === type).length])) } };
}
