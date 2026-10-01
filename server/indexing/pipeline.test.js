import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadCorpus } from './corpus.js';
import { buildIndexes } from './pipeline.js';
import { readIndex } from './store.js';
import { searchIndexes } from './search.js';
import { runCli } from './cli.js';

const embedder = {
  model: 'test-embedding',
  async embed(texts) { return texts.map(text => [/атом/iu.test(text) ? 1 : 0, /поиск|косинус/iu.test(text) ? 1 : 0, 0.1]); },
};

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'day21-'));
  await fs.writeFile(path.join(root, 'a.md'), '# Индекс\nИндекс записывается атомарно после построения.\n## Поиск\nКосинусное сходство ранжирует результаты.');
  await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify({ entries: [{ path: 'a.md', source: 'fixture' }] }));
  return { root, manifestPath: path.join(root, 'manifest.json'), indexesDir: path.join(root, 'indexes') };
}

test('bundled corpus exceeds 20 pages and contains Markdown, code, and PDF', async () => {
  const corpus = await loadCorpus();
  assert.ok(corpus.stats.estimatedPages >= 20);
  assert.ok(corpus.stats.types.markdown > 0 && corpus.stats.types.code > 0 && corpus.stats.types.pdf > 0);
});

test('pipeline writes valid versioned indexes and search ranks local chunks', async t => {
  const paths = await fixture(); t.after(() => fs.rm(paths.root, { recursive: true, force: true }));
  const result = await buildIndexes({ strategy: 'all', embedder, ...paths });
  assert.equal(result.indexes.length, 2);
  const fixed = await readIndex('fixed', paths.indexesDir);
  assert.equal(fixed.schema_version, 1);
  assert.equal(fixed.embedding.model, embedder.model);
  assert.ok(fixed.chunks[0].metadata.source);
  const found = await searchIndexes({ query: 'атомарный индекс', strategy: 'all', topK: 1, embedder, indexesDir: paths.indexesDir });
  assert.equal(Object.keys(found.results).length, 2);
  assert.match(found.results.structured[0].text, /атомарно/);
});

test('failed embeddings do not overwrite an existing index', async t => {
  const paths = await fixture(); t.after(() => fs.rm(paths.root, { recursive: true, force: true }));
  await buildIndexes({ strategy: 'fixed', embedder, ...paths });
  const before = await fs.readFile(path.join(paths.indexesDir, 'fixed.json'));
  await assert.rejects(buildIndexes({ strategy: 'fixed', embedder: { model: 'broken', embed: async () => { throw new Error('offline'); } }, ...paths }), /offline/);
  const after = await fs.readFile(path.join(paths.indexesDir, 'fixed.json'));
  assert.deepEqual(after, before);
});

test('CLI builds a selected strategy with an injected test embedder', async t => {
  const paths = await fixture(); t.after(() => fs.rm(paths.root, { recursive: true, force: true }));
  const lines = [];
  const result = await runCli({ argv: ['--strategy', 'structured'], embedder, ...paths, output: { table: value => lines.push(value), log: value => lines.push(value) } });
  assert.equal(result.indexes[0].strategy, 'structured');
  assert.match(lines.at(-1), /Корпус:/);
  await fs.access(path.join(paths.indexesDir, 'structured.json'));
});
