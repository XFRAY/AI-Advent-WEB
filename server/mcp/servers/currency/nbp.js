import { ToolError } from '../shared.js';
export class CurrencyError extends ToolError {}
const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

// NBP table A: average PLN rates of major currencies. Cross rates are computed through PLN.
export class NbpRates {
  constructor({ fetchImpl = globalThis.fetch, timeoutMs = 10_000 } = {}) {
    Object.assign(this, { fetchImpl, timeoutMs });
  }
  async rate(code) {
    if (code === 'PLN') return { mid: 1, date: null };
    let response, body;
    try {
      response = await this.fetchImpl(`https://api.nbp.pl/api/exchangerates/rates/a/${code.toLowerCase()}/?format=json`, {
        headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (response.status === 404) throw new CurrencyError(`НБП не публикует курс ${code} (таблица A).`);
      if (!response.ok) throw new CurrencyError('НБП временно недоступен. Повторите позже.');
      body = await response.json();
    } catch (error) {
      if (error instanceof CurrencyError) throw error;
      if (['TimeoutError', 'AbortError'].includes(error.name)) throw new CurrencyError('Превышено время ожидания НБП.');
      throw new CurrencyError('Не удалось получить курс НБП.');
    }
    const rate = body?.rates?.[0];
    if (!(Number.isFinite(rate?.mid) && rate.mid > 0) || typeof rate.effectiveDate !== 'string') throw new CurrencyError('НБП вернул некорректный курс.');
    return { mid: rate.mid, date: rate.effectiveDate };
  }
  async convert({ from, to, amounts }) {
    [from, to] = [from.toUpperCase(), to.toUpperCase()];
    const [source, target] = from === to ? [{ mid: 1, date: null }, { mid: 1, date: null }] : await Promise.all([this.rate(from), this.rate(to)]);
    const rate = source.mid / target.mid;
    const dates = [source.date, target.date].filter(Boolean).sort();
    return { from, to, rate: round(rate, 6), rateDate: dates.at(-1) ?? null, source: 'NBP, таблица A',
      amounts: amounts.map(amount => ({ amount, converted: round(amount * rate, 2) })) };
  }
}
