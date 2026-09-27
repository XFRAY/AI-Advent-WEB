const round = value => Math.round(value * 100) / 100;
const brief = item => ({ title: item.title, price_min: item.price_min, price_max: item.price_max });
// Altegio sends price_max=0 when no upper price is set: a max below the min means "no max".
const low = item => item.price_min ?? item.price_max;
const high = item => item.price_max !== null && item.price_max >= (item.price_min ?? 0) ? item.price_max : item.price_min;

export function priceStats(items) {
  const priced = items.filter(item => item.price_min !== null || item.price_max !== null);
  // Prices in different currencies are never mixed: statistics are grouped by currency; null is not zero.
  const groups = new Map();
  for (const item of priced) {
    const key = item.currency ?? null;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const byCurrency = [...groups].map(([currency, group]) => ({
    currency, count: group.length,
    priceMin: Math.min(...group.map(low)), priceMax: Math.max(...group.map(high)),
    averageMin: round(group.reduce((sum, item) => sum + low(item), 0) / group.length),
    cheapest: [...group].sort((a, b) => low(a) - low(b) || a.title.localeCompare(b.title)).slice(0, 3).map(brief),
    mostExpensive: [...group].sort((a, b) => high(b) - high(a) || a.title.localeCompare(b.title)).slice(0, 3).map(brief),
  }));
  const lines = [`Услуг: ${items.length}, с ценой: ${priced.length}.`];
  for (const group of byCurrency) lines.push(`Цены${group.currency ? ` (${group.currency})` : ' (валюта не указана)'}: от ${group.priceMin} до ${group.priceMax}, средняя минимальная ${group.averageMin}; самая доступная — ${group.cheapest[0].title}.`);
  if (items.length - priced.length) lines.push(`Без цены: ${items.length - priced.length}.`);
  return { count: items.length, priced: priced.length, unpriced: items.length - priced.length, byCurrency, text: lines.join(' ') };
}
