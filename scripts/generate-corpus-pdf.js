import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'corpus', 'indexing-handbook.pdf');
const topics = [
  ['Document ingestion', 'A reliable ingestion pipeline keeps source identity, file name, document type, and page boundaries. PDF extraction is tested separately because layout engines may return text in an unexpected order.'],
  ['Fixed size chunks', 'Fixed windows provide a deterministic baseline. A small overlap protects sentences near a boundary while increasing storage in a measurable way.'],
  ['Structure aware chunks', 'Headings, pages, functions, and classes are natural boundaries. Large sections may still be divided, but unrelated sections are never mixed.'],
  ['Embedding batches', 'Chunks are embedded in batches. Model name and vector dimension belong to the index manifest. Query vectors must use the same model as document vectors.'],
  ['Atomic persistence', 'The complete index is written to a temporary file and renamed only after success. A failed network request must leave the previous valid index untouched.'],
  ['Search evaluation', 'Cosine similarity is sufficient for a small local corpus. Side by side results reveal where fixed and structured chunking make different retrieval decisions.'],
];

function escapePdf(value) { return value.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)'); }
const objects = new Map();
const fontId = 3 + topics.length * 2;
objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
const pageIds = topics.map((_, index) => 3 + index * 2);
objects.set(2, `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${topics.length} >>`);
topics.forEach(([title, paragraph], index) => {
  const pageId = 3 + index * 2;
  const contentId = pageId + 1;
  const lines = [title, '', paragraph, '', `Handbook page ${index + 1} of ${topics.length}.`];
  const commands = ['BT', '/F1 15 Tf', '72 760 Td'];
  for (const [lineIndex, line] of lines.entries()) {
    if (lineIndex) commands.push('0 -28 Td');
    commands.push(`(${escapePdf(line)}) Tj`);
  }
  commands.push('ET');
  const stream = commands.join('\n');
  objects.set(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
  objects.set(contentId, `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
});
objects.set(fontId, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

let pdf = '%PDF-1.4\n';
const offsets = [0];
for (let id = 1; id <= fontId; id += 1) {
  offsets[id] = Buffer.byteLength(pdf);
  pdf += `${id} 0 obj\n${objects.get(id)}\nendobj\n`;
}
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 ${fontId + 1}\n0000000000 65535 f \n`;
for (let id = 1; id <= fontId; id += 1) pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
pdf += `trailer\n<< /Size ${fontId + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
await fs.writeFile(output, pdf, 'latin1');
console.log(output);
