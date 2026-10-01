import fs from 'node:fs/promises';
import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const codeExtensions = new Set(['.js', '.jsx', '.mjs', '.ts', '.tsx', '.py', '.java', '.kt']);

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

export function parseCode(text, fallbackTitle) {
  const pattern = /^(?:export\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type)\s+([\w$]+)|^(?:public\s+|private\s+|protected\s+)?(?:class|interface|object|fun)\s+([\w$]+)/gm;
  const boundaries = [...text.matchAll(pattern)].map(match => ({ start: match.index, title: match[1] || match[2] }));
  return sectionsFromBoundaries(text, boundaries, fallbackTitle);
}

async function parsePdf(buffer, fallbackTitle) {
  const document = await getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent({ includeMarkedContent: false });
    pages.push(content.items.map(item => item.str).join(' ').replace(/\s+/g, ' ').trim());
  }
  let cursor = 0;
  const text = pages.join('\n\n');
  const sections = pages.map((page, index) => {
    const start = cursor;
    cursor += page.length + (index < pages.length - 1 ? 2 : 0);
    return { title: `Страница ${index + 1}`, text: page, start, end: start + page.length };
  });
  return { text, sections, pages: document.numPages };
}

export async function parseDocument({ absolutePath, relativePath, source }) {
  const extension = path.extname(relativePath).toLowerCase();
  const title = path.basename(relativePath, extension);
  if (extension === '.pdf') {
    const parsed = await parsePdf(await fs.readFile(absolutePath), title);
    return { source, title, file: relativePath, absolutePath, type: 'pdf', ...parsed };
  }
  const text = await fs.readFile(absolutePath, 'utf8');
  const sections = extension === '.md' ? parseMarkdown(text, title) : codeExtensions.has(extension) ? parseCode(text, title) : [{ title, text, start: 0, end: text.length }];
  return { source, title, file: relativePath, absolutePath, type: extension === '.md' ? 'markdown' : codeExtensions.has(extension) ? 'code' : 'text', text, sections };
}
