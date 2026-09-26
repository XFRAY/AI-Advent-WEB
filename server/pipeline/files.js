import { link, mkdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { PipelineError, renderMarkdown, verify } from './summarize.js';

export const defaultReportsDir = (env = process.env) => env.REPORTS_DIR || fileURLToPath(new URL('../../data/reports', import.meta.url));
// Same shape as names produced by saveReport; used to validate download requests.
export const reportFilePattern = /^[\p{L}\p{N}-]+\.(md|json)$/u;

// Letters, digits and dashes only: no separators or dots, so the path cannot leave the directory.
export function safeName(name, now = new Date()) {
  const cleaned = String(name ?? '').toLocaleLowerCase().replace(/[^\p{L}\p{N}-]+/gu, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  return cleaned || `services-${now.toISOString().replace(/\D/g, '').slice(0, 14)}`;
}

export async function saveReport({ dir, report, format = 'md', name, now = new Date() }) {
  const reportChecksum = verify(report, 'сводки');
  const file = `${safeName(name, now)}.${format}`;
  const content = format === 'json' ? `${JSON.stringify(report, null, 2)}\n` : renderMarkdown(report);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const temp = join(dir, `.${randomUUID()}.tmp`);
  await writeFile(temp, content, { mode: 0o600 });
  try {
    // link() fails on an existing target, unlike rename(): reports are never overwritten.
    await link(temp, join(dir, file));
  } catch (error) {
    if (error.code === 'EEXIST') throw new PipelineError(`Файл ${file} уже существует. Укажите другое имя.`);
    throw new PipelineError('Не удалось сохранить отчёт.');
  } finally { await unlink(temp).catch(() => {}); }
  return { file, format, bytes: Buffer.byteLength(content), reportChecksum, savedAt: now.toISOString() };
}
