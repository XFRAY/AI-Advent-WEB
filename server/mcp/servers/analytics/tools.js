import { z } from 'zod';
const price = z.number().nonnegative().nullable();
const item = z.object({
  title: z.string().min(1).max(300), price_min: price, price_max: price,
  currency: z.string().max(10).nullable().optional().describe('Код валюты из данных услуги; null — не указана.'),
});
export const analyticsTools = {
  analytics_price_stats: {
    description: 'Считает статистику цен по списку услуг: количество, с ценой и без, минимум, максимум и средняя минимальная цена отдельно по каждой валюте, три самых доступных и дорогих. Передай items из результата altegio_search_services без изменения цен.',
    schema: z.object({ items: z.array(item).min(1).max(200) }).strict(),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
};
