import { link, mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { ToolError } from '../shared.js';

export const defaultReportsDir = (env = process.env) => env.REPORTS_DIR || fileURLToPath(new URL('../../../../data/reports', import.meta.url));
// Same shape as names produced by saveReport; used to validate read and download requests.
export const reportFilePattern = /^[\p{L}\p{N}-]+\.md$/u;
const MAX_READ = 20_000;

// Letters, digits and dashes only: no separators or dots, so the path cannot leave the directory.
export function safeName(name, now = new Date()) {
  const cleaned = String(name ?? '').toLocaleLowerCase().replace(/[^\p{L}\p{N}-]+/gu, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  return cleaned || `report-${now.toISOString().replace(/\D/g, '').slice(0, 14)}`;
}
export async function saveReport({ dir, title, markdown, name, now = new Date() }) {
  const file = `${safeName(name, now)}.md`;
  const content = `# ${title.replace(/[\r\n]+/g, ' ').trim()}\n\n${markdown.trim()}\n`;
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const temp = join(dir, `.${randomUUID()}.tmp`);
  await writeFile(temp, content, { mode: 0o600 });
  try {
    // link() fails on an existing target, unlike rename(): reports are never overwritten.
    await link(temp, join(dir, file));
  } catch (error) {
    if (error.code === 'EEXIST') throw new ToolError(`Файл ${file} уже существует. Укажите другое имя.`);
    throw new ToolError('Не удалось сохранить отчёт.');
  } finally { await unlink(temp).catch(() => {}); }
  return { file, bytes: Buffer.byteLength(content), savedAt: now.toISOString() };
}
export async function listReports({ dir }) {
  let names;
  try { names = await readdir(dir); } catch (error) { if (error.code === 'ENOENT') return { reports: [], total: 0 }; throw new ToolError('Не удалось прочитать каталог отчётов.'); }
  const reports = await Promise.all(names.filter(name => reportFilePattern.test(name)).map(async file => {
    const info = await stat(join(dir, file));
    return { file, bytes: info.size, modifiedAt: info.mtime.toISOString() };
  }));
  reports.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt) || a.file.localeCompare(b.file));
  return { reports: reports.slice(0, 50), total: reports.length };
}
export async function readReport({ dir, file }) {
  if (!reportFilePattern.test(file)) throw new ToolError('Некорректное имя отчёта.');
  let content;
  try { content = await readFile(join(dir, file), 'utf8'); } catch (error) { throw new ToolError(error.code === 'ENOENT' ? `Отчёт ${file} не найден.` : 'Не удалось прочитать отчёт.'); }
  return { file, content: content.slice(0, MAX_READ), truncated: content.length > MAX_READ };
}
