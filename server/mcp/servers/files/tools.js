import { z } from 'zod';
export const filesTools = {
  files_save_report: {
    description: 'Сохраняет Markdown-отчёт в новый файл в каталоге отчётов сервера. Существующие файлы не перезаписываются. Возвращает имя файла.',
    schema: z.object({
      title: z.string().trim().min(1).max(200).describe('Заголовок отчёта, одна строка.'),
      markdown: z.string().trim().min(1).max(100_000).describe('Тело отчёта в Markdown без заголовка первого уровня.'),
      name: z.string().trim().max(80).optional().describe('Имя файла без расширения; по умолчанию report-<время>.'),
    }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  files_list_reports: {
    description: 'Возвращает список сохранённых отчётов (до 50, новые первыми): имя файла, размер и время изменения.',
    schema: z.object({}).strict(),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  files_read_report: {
    description: 'Читает сохранённый отчёт по имени файла из files_list_reports или files_save_report.',
    schema: z.object({ file: z.string().max(100).describe('Имя файла, например report-20260926120000.md.') }).strict(),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
};
