import { createHash } from 'node:crypto';
import { splitTokenWindows } from './tokenizer.js';

export const CHUNKING = Object.freeze({
  fixed: { size: 500, overlap: 75 },
  structured: { size: 700, overlap: 75 },
});

function stableId(parts) {
  return createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 24);
}

function makeChunk(document, strategy, section, window, ordinal) {
  const chunkId = stableId([strategy, document.file, section, String(ordinal), window.text]);
  return {
    chunk_id: chunkId,
    text: window.text,
    metadata: {
      source: document.source,
      title: document.title,
      file: document.file,
      section,
      chunk_id: chunkId,
      strategy,
      position: ordinal,
      token_start: window.tokenStart,
      token_end: window.tokenEnd,
      token_count: window.tokenCount,
    },
  };
}

export function chunkDocuments(documents, strategy) {
  if (!CHUNKING[strategy]) throw new TypeError(`Неизвестная стратегия chunking: ${strategy}`);
  const chunks = [];
  for (const document of documents) {
    let ordinal = 0;
    if (strategy === 'fixed') {
      for (const window of splitTokenWindows(document.text, CHUNKING.fixed)) chunks.push(makeChunk(document, strategy, document.title, window, ordinal++));
      continue;
    }
    for (const section of document.sections) {
      for (const window of splitTokenWindows(section.text, CHUNKING.structured)) chunks.push(makeChunk(document, strategy, section.title, window, ordinal++));
    }
  }
  return chunks;
}
