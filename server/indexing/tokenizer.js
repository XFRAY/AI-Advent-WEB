export function tokensWithOffsets(text) {
  return [...text.matchAll(/\p{L}[\p{L}\p{N}_'’-]*|\p{N}+(?:[.,]\p{N}+)*|[^\s]/gu)].map(match => ({
    value: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }));
}

export function tokenCount(text) {
  return tokensWithOffsets(text).length;
}

export function splitTokenWindows(text, { size, overlap = 0 }) {
  if (!Number.isInteger(size) || size < 1 || !Number.isInteger(overlap) || overlap < 0 || overlap >= size) {
    throw new TypeError('Некорректные параметры окна токенов.');
  }
  const tokens = tokensWithOffsets(text);
  if (!tokens.length) return [];
  const chunks = [];
  const step = size - overlap;
  for (let tokenStart = 0; tokenStart < tokens.length; tokenStart += step) {
    const tokenEnd = Math.min(tokenStart + size, tokens.length);
    const start = tokens[tokenStart].start;
    const end = tokens[tokenEnd - 1].end;
    chunks.push({ text: text.slice(start, end).trim(), tokenStart, tokenEnd, start, end, tokenCount: tokenEnd - tokenStart });
    if (tokenEnd === tokens.length) break;
  }
  return chunks;
}
