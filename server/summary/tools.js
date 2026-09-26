import { z } from 'zod';
import { TOOL_NAME, inputSchema, description } from '../mcp/altegio.js';
export const timezoneSchema = z.string().trim().max(100).refine(value => {
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return value === 'UTC' || value.includes('/'); } catch { return false; }
}, 'Укажите IANA timezone, например Europe/Warsaw.');
export const summaryTools = {
  summary_schedule_set: { description: 'Включает сбор движения денег за сегодня по выбранному филиалу каждые intervalMinutes минут. Первый сбор сразу. Если часовой пояс филиала неизвестен, спроси timezone у пользователя.', schema: z.object({ intervalMinutes: z.number().int().min(1).max(1440).default(60), timezone: timezoneSchema.optional() }).strict() },
  summary_schedule_status: { description: 'Возвращает состояние расписания, филиал, часовой пояс, следующий запуск и последнюю успешную сводку.', schema: z.object({}).strict() },
  summary_schedule_pause: { description: 'Приостанавливает периодический сбор, сохраняя историю.', schema: z.object({}).strict() },
  summary_run_now: { description: 'Собирает и сохраняет движение денег за сегодня сейчас; при текущем сборе возвращает его состояние. timezone нужен, если часовой пояс неизвестен.', schema: z.object({ timezone: timezoneSchema.optional() }).strict() },
  summary_results: { description: 'Возвращает последние сохранённые сводки и ошибки, новые первыми. Это снимки дневного итога — их нельзя складывать.', schema: z.object({ limit: z.number().int().min(1).max(100).default(20) }).strict() },
};
export const toolDefinitions = { [TOOL_NAME]: { schema: inputSchema, description }, ...summaryTools };
