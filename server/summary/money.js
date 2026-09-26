import { AltegioError } from '../mcp/altegio.js';
export class SummaryError extends AltegioError {
  constructor(message, code = 'upstream') { super(message); this.code = code; }
}
export function localDate(now, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
// All arithmetic uses base-10 integers. Amounts remain decimal strings in JSON.
export function decimal(value) {
  const match = /^(-?)(\d{1,30})(?:\.(\d{1,20}))?(?:[eE]([+-]?\d{1,2}))?$/.exec(String(value));
  if (!match) throw new SummaryError('Некорректная сумма транзакции.');
  let units = BigInt(`${match[1]}${match[2]}${match[3] || ''}`);
  let scale = (match[3] || '').length - Number(match[4] || 0);
  if (scale < 0) { units *= 10n ** BigInt(-scale); scale = 0; }
  return { units, scale };
}
function format(units, scale) {
  const sign = units < 0n ? '-' : '';
  const digits = (units < 0n ? -units : units).toString().padStart(scale + 1, '0');
  return sign + (scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits);
}
export function aggregate(rows) {
  const values = rows.map(row => decimal(row.amount));
  const scale = Math.max(2, ...values.map(v => v.scale));
  let incoming = 0n, outgoing = 0n;
  for (const value of values) {
    const units = value.units * 10n ** BigInt(scale - value.scale);
    if (units >= 0n) incoming += units; else outgoing -= units;
  }
  return { incoming: format(incoming, scale), outgoing: format(outgoing, scale), net: format(incoming - outgoing, scale), transactionCount: rows.length };
}
export class MoneyApi {
  constructor({ partnerToken, userToken, locationId, fetchImpl = globalThis.fetch, pageSize = 200, timeoutMs = 20_000 } = {}) {
    Object.assign(this, { partnerToken, userToken, locationId, fetchImpl, pageSize, timeoutMs });
  }
  async get(path, params = {}, signal = AbortSignal.timeout(this.timeoutMs)) {
    if (!this.partnerToken || !this.userToken) throw new SummaryError('Войдите в Altegio для сбора сводок.', 'auth');
    if (!/^[1-9]\d*$/.test(String(this.locationId))) throw new SummaryError('Выберите филиал.', 'location');
    const url = new URL(`https://api.alteg.io/api/v1/${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    try {
      const response = await this.fetchImpl(url, { headers: { Authorization: `Bearer ${this.partnerToken}, User ${this.userToken}`, Accept: 'application/vnd.api.v2+json', 'Content-Type': 'application/json' }, signal, redirect: 'error' });
      if (response.status === 401) throw new SummaryError('Авторизация Altegio истекла. Войдите снова.', 'auth');
      if (response.status === 403) throw new SummaryError('Нет доступа к финансовым данным филиала.', 'access');
      if (!response.ok) throw new SummaryError(response.status === 429 ? 'Altegio ограничил частоту запросов. Повторим по расписанию.' : 'Altegio временно недоступен.');
      // Preserve decimal tokens before JSON.parse can round them through binary Number.
      const raw = await response.text();
      const body = JSON.parse(raw.replace(/"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g, token => token.startsWith('"') ? token : JSON.stringify(token)));
      if (body.success === false || body.data == null) throw new SummaryError('Некорректный ответ Altegio.');
      return body.data;
    } catch (error) {
      if (error instanceof SummaryError) throw error;
      throw new SummaryError(signal.aborted ? 'Истекло время загрузки сводки.' : 'Не удалось загрузить данные Altegio.');
    }
  }
  async metadata() {
    const data = await this.get(`company/${this.locationId}`);
    if (!data || Array.isArray(data) || typeof data !== 'object') throw new SummaryError('Некорректные данные филиала.');
    return { title: typeof data.title === 'string' ? data.title : String(this.locationId), timezone: data.timezone_name || null, currency: typeof data.currency_short_title === 'string' ? data.currency_short_title : typeof data.currency === 'string' ? data.currency : null };
  }
  async collect({ timezone, now = new Date(), title, currency }) {
    const date = localDate(now, timezone);
    const day = date.replaceAll('-', '');
    const signal = AbortSignal.timeout(this.timeoutMs);
    const rows = [], seen = new Set();
    for (let page = 1; page <= 100; page++) {
      const data = await this.get(`transactions/${this.locationId}`, { page, count: this.pageSize, start_date: day, end_date: day, real_money: 1, deleted: 0, balance_is: 0 }, signal);
      if (!Array.isArray(data)) throw new SummaryError('Некорректный список транзакций.');
      for (const row of data) {
        if (!row || !/^[1-9]\d*$/.test(String(row.id)) || seen.has(String(row.id))) throw new SummaryError('Некорректная или повторная страница транзакций.');
        seen.add(String(row.id));
        if ([true, 1, '1'].includes(row.deleted) || [false, 0, '0'].includes(row.real_money)) continue;
        if (typeof row.date !== 'string' || !/([zZ]|[+-]\d{2}:?\d{2})$/.test(row.date) || !Number.isFinite(Date.parse(row.date))) throw new SummaryError('Некорректная дата транзакции.');
        if (localDate(new Date(row.date), timezone) !== date) continue;
        if (typeof row.currency === 'string' && currency && row.currency !== currency) throw new SummaryError('В транзакциях обнаружены разные валюты.');
        rows.push({ amount: row.amount });
      }
      if (data.length < this.pageSize) {
        const totals = aggregate(rows);
        return { locationId: String(this.locationId), locationTitle: title, timezone, date, currency: currency || null, collectedAt: now.toISOString(), ...totals,
          text: `${date}: поступления ${totals.incoming}, списания ${totals.outgoing}, итог ${totals.net}${currency ? ` ${currency}` : ' (валюта не указана)'}. Операций: ${totals.transactionCount}.` };
      }
    }
    throw new SummaryError('Достигнут предел страниц. Полная сводка не получена.');
  }
}
