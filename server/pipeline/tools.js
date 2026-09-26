import { z } from 'zod';
const price = z.number().nonnegative().nullable();
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const brief = z.object({ id: z.string(), title: z.string(), price_min: price, price_max: price });
export const searchResultSchema = z.object({
  query: z.string().max(200), searchMode: z.enum(['literal', 'catalog_fallback']), truncated: z.boolean(), fetchedAt: z.string().datetime(),
  items: z.array(brief.extend({ currency: z.string().nullable() })).max(100), checksum: hash,
});
export const reportSchema = z.object({
  sourceChecksum: hash, query: z.string().max(200), searchMode: z.enum(['literal', 'catalog_fallback']), truncated: z.boolean(),
  fetchedAt: z.string().datetime(), summarizedAt: z.string().datetime(), count: z.number().int().nonnegative(),
  priced: z.number().int().nonnegative(), unpriced: z.number().int().nonnegative(),
  byCurrency: z.array(z.object({ currency: z.string().nullable(), count: z.number().int().positive(), priceMin: z.number(), priceMax: z.number(), averageMin: z.number(), cheapest: z.array(brief).max(3), mostExpensive: z.array(brief).max(3) })),
  items: z.array(brief).max(100), text: z.string().max(5000), checksum: hash,
});
export const pipelineTools = {
  pipeline_search: {
    description: 'Шаг 1 пайплайна отчёта: ищет услуги филиала Altegio по названию и возвращает items с ценами и checksum. Результат целиком передай в pipeline_summarize как source.',
    schema: z.object({ query: z.string().trim().max(200).optional().describe('Буквальный поиск по названию; без параметра — весь каталог.'), limit: z.number().int().min(1).max(100).default(50) }).strict(),
  },
  pipeline_summarize: {
    description: 'Шаг 2: считает сводку по результату pipeline_search (количество, диапазон и средние цены по валютам, самые доступные и дорогие). source — полный неизменённый результат поиска, иначе checksum не сойдётся.',
    schema: z.object({ source: searchResultSchema }).strict(),
  },
  pipeline_save_to_file: {
    description: 'Шаг 3: сохраняет результат pipeline_summarize в файл отчёта (md или json) в каталоге отчётов сервера. report — полный неизменённый результат сводки. Существующие файлы не перезаписываются.',
    schema: z.object({ report: reportSchema, format: z.enum(['md', 'json']).default('md'), name: z.string().trim().max(80).optional().describe('Имя файла без расширения; по умолчанию services-<время>.') }).strict(),
  },
};
