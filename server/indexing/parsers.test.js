import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { parseDocument, parseMarkdown } from './parsers.js';
import { projectRoot } from './corpus.js';

test('Markdown parser uses headings as sections', () => {
  const sections = parseMarkdown('Вступление\n# Первый\nТекст\n## Второй\nЕщё', 'Документ');
  assert.deepEqual(sections.map(item => item.title), ['Документ', 'Первый', 'Второй']);
});

test('PDF parser preserves individual page sections', async () => {
  const relativePath = 'corpus/indexing-handbook.pdf';
  const document = await parseDocument({ absolutePath: path.join(projectRoot, relativePath), relativePath, source: 'test-pdf' });
  assert.equal(document.type, 'pdf');
  assert.equal(document.pages, 6);
  assert.equal(document.sections.length, 6);
  assert.match(document.sections[4].text, /Atomic persistence/);
});
