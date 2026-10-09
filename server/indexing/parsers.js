import fs from 'node:fs/promises';
import path from 'node:path';

function sectionsFromBoundaries(text, boundaries, fallback) {
  if (!boundaries.length || boundaries[0].start !== 0) boundaries.unshift({ start: 0, title: fallback });
  return boundaries.map((item, index) => ({
    title: item.title,
    text: text.slice(item.start, boundaries[index + 1]?.start ?? text.length).trim(),
    start: item.start,
    end: boundaries[index + 1]?.start ?? text.length,
  })).filter(section => section.text);
}

export function parseMarkdown(text, fallbackTitle) {
  const boundaries = [...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map(match => ({ start: match.index, title: match[1].trim() }));
  return sectionsFromBoundaries(text, boundaries, fallbackTitle);
}

export async function parseDocument({ absolutePath, relativePath, source }) {
  const extension = path.extname(relativePath).toLowerCase();
  const title = path.basename(relativePath, extension);
  const text = await fs.readFile(absolutePath, 'utf8');
  const sections = extension === '.md' ? parseMarkdown(text, title) : [{ title, text, start: 0, end: text.length }];
  return { source, title, file: relativePath, absolutePath, type: extension === '.md' ? 'markdown' : 'text', text, sections };
}
