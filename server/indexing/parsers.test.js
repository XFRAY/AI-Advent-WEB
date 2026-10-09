import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown } from './parsers.js';

test('Markdown parser uses headings as sections', () => {
  const sections = parseMarkdown('Вступление\n# Первый\nТекст\n## Второй\nЕщё', 'Документ');
  assert.deepEqual(sections.map(item => item.title), ['Документ', 'Первый', 'Второй']);
});
