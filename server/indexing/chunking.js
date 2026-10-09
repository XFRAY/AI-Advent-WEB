import { createHash } from 'node:crypto';
import { splitTokenWindows } from './tokenizer.js';

export const CHUNKING = Object.freeze({ size: 700, overlap: 75 });

function stableId(parts) {
  return createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 24);
}

function makeChunk(document, section, window, ordinal) {
  const chunkId = stableId(['structured', document.file, section, String(ordinal), window.text]);
  return {
    chunk_id: chunkId,
    text: window.text,
    metadata: {
      source: document.source,
      title: document.title,
      file: document.file,
      section,
      chunk_id: chunkId,
      strategy: 'structured',
      position: ordinal,
      token_start: window.tokenStart,
      token_end: window.tokenEnd,
      token_count: window.tokenCount,
    },
  };
}

export function chunkDocuments(documents) {
  const chunks = [];
  for (const document of documents) {
    let ordinal = 0;
    for (const section of document.sections) {
      for (const window of splitTokenWindows(section.text, CHUNKING)) chunks.push(makeChunk(document, section.title, window, ordinal++));
    }
  }
  return chunks;
}
