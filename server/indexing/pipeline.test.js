import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadCorpus } from './corpus.js';
import { buildIndex } from './pipeline.js';
import { readIndex } from './store.js';
import { searchIndex } from './search.js';
import { runCli } from './cli.js';

const embedder = { model: 'test-embedding', async embed(texts) { return texts.map(text => [/атом/iu.test(text) ? 1 : 0, /поиск|косинус/iu.test(text) ? 1 : 0, 0.1]); } };

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'day25-index-'));
  await fs.writeFile(path.join(root, 'a.md'), '# Индекс\nИндекс записывается атомарно после построения.\n## Поиск\nКосинусное сходство ранжирует результаты.');
  await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify({ entries: [{ path: 'a.md', source: 'fixture' }] }));
  return { root, manifestPath: path.join(root, 'manifest.json'), indexesDir: path.join(root, 'indexes') };
}

test('bundled corpus contains five cafe knowledge sources', async () => {
  const corpus = await loadCorpus();
  assert.equal(corpus.stats.documents, 5);
  assert.equal(corpus.stats.types.markdown, 5);
  assert.deepEqual(new Set(corpus.documents.map(item => item.source)), new Set(['cafe-sever', 'cafe-most', 'cafe-zeleny-sad', 'cafe-pristan', 'cafe-atelier']));
  assert.ok(corpus.documents.every(item => /Кафе/.test(item.text)));
});

test('pipeline writes structured index and search returns top-k local chunks', async t => {
  const paths = await fixture(); t.after(() => fs.rm(paths.root, { recursive: true, force: true }));
  const result = await buildIndex({ embedder, ...paths });
  assert.equal(result.index.strategy, 'structured');
  const index = await readIndex(paths.indexesDir);
  assert.equal(index.schema_version, 1);
  assert.equal(index.embedding.model, embedder.model);
  assert.ok(index.chunks[0].metadata.source);
  const found = await searchIndex({ query: 'атомарный индекс', topK: 1, embedder, indexesDir: paths.indexesDir });
  assert.equal(found.results.length, 1);
  assert.match(found.results[0].text, /атомарно/);
});

test('failed embeddings do not overwrite an existing index', async t => {
  const paths = await fixture(); t.after(() => fs.rm(paths.root, { recursive: true, force: true }));
  await buildIndex({ embedder, ...paths });
  const target = path.join(paths.indexesDir, 'structured.json');
  const before = await fs.readFile(target);
  await assert.rejects(buildIndex({ embedder: { model: 'broken', embed: async () => { throw new Error('offline'); } }, ...paths }), /offline/);
  assert.deepEqual(await fs.readFile(target), before);
});

test('CLI builds the structured index with an injected embedder', async t => {
  const paths = await fixture(); t.after(() => fs.rm(paths.root, { recursive: true, force: true }));
  const lines = [];
  const result = await runCli({ embedder, ...paths, output: { table: value => lines.push(value), log: value => lines.push(value) } });
  assert.equal(result.index.strategy, 'structured');
  assert.match(lines.at(-1), /Корпус:/);
  await fs.access(path.join(paths.indexesDir, 'structured.json'));
});
