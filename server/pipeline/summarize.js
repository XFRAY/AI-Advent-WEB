import { createHash } from 'node:crypto';
import { AltegioError } from '../mcp/altegio.js';

export class PipelineError extends AltegioError {}

// Stable key order: the checksum depends only on the data, not on how JSON was serialized.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const checksum = value => createHash('sha256').update(canonical(value)).digest('hex');
// Every step output is signed over everything except its own checksum field.
export const sign = payload => ({ ...payload, checksum: checksum(payload) });
export function verify(payload, label) {
  const { checksum: expected, ...rest } = payload;
  if (expected !== checksum(rest)) throw new PipelineError(`Данные повреждены при передаче: checksum ${label} не совпадает.`);
  return expected;
}

export function toSearchResult({ services, truncated, query, searchMode }, now = new Date()) {
  return sign({ query: query || '', searchMode: searchMode || 'literal', truncated: Boolean(truncated), fetchedAt: now.toISOString(),
    items: services.map(({ id, title, price_min, price_max, currency }) => ({ id, title, price_min, price_max, currency })) });
}

const round = value => Math.round(value * 100) / 100;
const brief = item => ({ id: item.id, title: item.title, price_min: item.price_min, price_max: item.price_max });
export function summarizeServices(source, now = new Date()) {
  const sourceChecksum = verify(source, 'результата поиска');
  const priced = source.items.filter(item => item.price_min !== null || item.price_max !== null);
  // Prices in different currencies are never mixed: statistics are grouped by currency.
  const groups = new Map();
  for (const item of priced) {
    const key = item.currency ?? null;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const low = item => item.price_min ?? item.price_max;
  // Altegio sends price_max=0 when no upper price is set: a max below the min means "no max".
  const high = item => item.price_max !== null && item.price_max >= (item.price_min ?? 0) ? item.price_max : item.price_min;
  const byCurrency = [...groups].map(([currency, items]) => {
    const sorted = [...items].sort((a, b) => low(a) - low(b) || a.title.localeCompare(b.title));
    return { currency, count: items.length, priceMin: Math.min(...items.map(low)), priceMax: Math.max(...items.map(high)),
      averageMin: round(items.reduce((sum, item) => sum + low(item), 0) / items.length),
      cheapest: sorted.slice(0, 3).map(brief), mostExpensive: [...items].sort((a, b) => high(b) - high(a) || a.title.localeCompare(b.title)).slice(0, 3).map(brief) };
  });
  const lines = [`${source.query ? `Услуг по запросу «${source.query}»` : 'Услуг в каталоге'}: ${source.items.length}${source.truncated ? ' (показана часть каталога)' : ''}.`];
  if (source.searchMode === 'catalog_fallback') lines.push('Буквальных совпадений нет — это кандидаты из каталога.');
  for (const group of byCurrency) lines.push(`Цены${group.currency ? ` (${group.currency})` : ' (валюта не указана)'}: от ${group.priceMin} до ${group.priceMax}, средняя минимальная ${group.averageMin}; самая доступная — ${group.cheapest[0].title}.`);
  if (source.items.length - priced.length) lines.push(`Без цены: ${source.items.length - priced.length}.`);
  return sign({ sourceChecksum, query: source.query, searchMode: source.searchMode, truncated: source.truncated, fetchedAt: source.fetchedAt,
    summarizedAt: now.toISOString(), count: source.items.length, priced: priced.length, unpriced: source.items.length - priced.length,
    byCurrency, items: source.items.map(brief), text: lines.join(' ') });
}

const cell = value => String(value ?? '—').replace(/[|\\\r\n]/g, ' ');
export function renderMarkdown(report) {
  const rows = report.items.map(item => `| ${cell(item.title)} | ${cell(item.price_min)} | ${cell(item.price_max)} |`);
  return [`# Отчёт по услугам: ${report.query ? cell(report.query) : 'весь каталог'}`, '',
    report.text, '',
    `- Данные получены: ${report.fetchedAt}`, `- Сводка: ${report.summarizedAt}`, `- Услуг: ${report.count}, с ценой: ${report.priced}, без цены: ${report.unpriced}`,
    ...report.byCurrency.map(group => `- ${group.currency || 'Валюта не указана'}: ${group.priceMin}–${group.priceMax}, средняя минимальная ${group.averageMin}`),
    '', '| Услуга | Цена от | Цена до |', '|---|---|---|', ...rows, '',
    `Checksum отчёта: \`${report.checksum}\`, источника: \`${report.sourceChecksum}\``, ''].join('\n');
}
