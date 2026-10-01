import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkDocuments } from './chunking.js';
import { splitTokenWindows } from './tokenizer.js';

const words = count => Array.from({ length: count }, (_, index) => `слово${index}`).join(' ');

test('fixed chunking creates 500-token windows with 75-token overlap', () => {
  const windows = splitTokenWindows(words(1_000), { size: 500, overlap: 75 });
  assert.deepEqual(windows.map(item => item.tokenCount), [500, 500, 150]);
  assert.equal(windows[0].text.split(' ').slice(-75).join(' '), windows[1].text.split(' ').slice(0, 75).join(' '));
});

test('structured chunks never cross section boundaries and IDs are stable', () => {
  const document = { source: 'test', title: 'Guide', file: 'guide.md', text: `${words(800)}\n${words(20)}`, sections: [{ title: 'Large', text: words(800) }, { title: 'Small', text: words(20) }] };
  const first = chunkDocuments([document], 'structured');
  const second = chunkDocuments([document], 'structured');
  assert.deepEqual(first.map(item => item.chunk_id), second.map(item => item.chunk_id));
  assert.deepEqual([...new Set(first.map(item => item.metadata.section))], ['Large', 'Small']);
  assert.equal(first.at(-1).metadata.token_count, 20);
  assert.ok(first.every(item => item.metadata.chunk_id === item.chunk_id));
});
