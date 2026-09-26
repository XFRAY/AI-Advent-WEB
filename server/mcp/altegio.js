import { z } from 'zod';

const inputShape = {
  query: z.string().trim().max(200).optional().describe('Буквальный поиск по названию без учёта регистра. Названия могут быть на другом языке. Если совпадений нет, searchMode=catalog_fallback возвращает кандидатов для отбора по смыслу, а не точные совпадения. Без параметра — каталог.'),
  limit: z.number().int().min(1).max(100).default(20).describe('Максимальное число услуг в ответе: 1–100, по умолчанию 20.'),
};
export const inputSchema = z.object(inputShape).strict();
export class AltegioError extends Error {}
const numberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(number) && number >= 0 ? number : null;
};

export class AltegioApi {
  constructor({ partnerToken = process.env.ALTEGIO_PARTNER_TOKEN, userToken = process.env.ALTEGIO_USER_TOKEN,
    locationId = process.env.ALTEGIO_LOCATION_ID, fetchImpl = globalThis.fetch, timeoutMs = 20_000, pageSize = 250 } = {}) {
    Object.assign(this, { partnerToken, userToken, locationId, fetchImpl, timeoutMs, pageSize });
  }

  async listServices(args) {
    const { query = '', limit } = inputSchema.parse(args);
    if (!this.partnerToken) throw new AltegioError('Настройте ALTEGIO_PARTNER_TOKEN на сервере.');
    if (!this.userToken) throw new AltegioError('Войдите в Altegio через форму слева.');
    if (!/^[1-9]\d*$/.test(String(this.locationId))) throw new AltegioError('Выберите филиал в списке слева. Если список пуст, обновите список филиалов.');
    const services = [];
    const candidates = [];
    const finish = () => {
      if (query && !services.length && candidates.length) return {
        services: candidates.slice(0, limit), truncated: candidates.length > limit, query, limit,
        searchMode: 'catalog_fallback',
        searchHint: 'Буквальных совпадений нет. Это кандидаты из каталога, а не результаты фильтра. Отберите подходящие услуги по смыслу и языку названий. Если список ограничен, уточните query на языке каталога. Не утверждайте, что услуги отсутствуют, на основании одного буквального поиска.',
      };
      return { services, truncated: false, query, limit };
    };
    const seen = new Set();
    const signal = AbortSignal.timeout(this.timeoutMs);
    for (let page = 1; page <= 100; page++) {
      const url = new URL(`https://api.alteg.io/api/v2/locations/${this.locationId}/services`);
      url.searchParams.set('page', String(page));
      url.searchParams.set('limit', String(this.pageSize));
      url.searchParams.set('include', 'company_links');
      let response;
      let body;
      try {
        response = await this.fetchImpl(url, {
          headers: { Authorization: `Bearer ${this.partnerToken}, User ${this.userToken}`, Accept: 'application/vnd.api.v2+json' },
          signal, redirect: 'error',
        });
        if (!response.ok) {
          const errors = { 401: 'Altegio: авторизация недействительна. Выйдите и войдите снова через форму слева.', 403: 'Altegio: нет доступа к услугам филиала.', 404: 'Altegio: филиал не найден.', 429: 'Altegio: превышен лимит запросов. Повторите позже.' };
          throw new AltegioError(errors[response.status] || 'Altegio временно недоступен.');
        }
        body = await response.json();
      } catch (error) {
        if (error instanceof AltegioError) throw error;
        if (signal.aborted || error.name === 'TimeoutError' || error.name === 'AbortError') throw new AltegioError('Превышено время ожидания Altegio.');
        throw new AltegioError('Не удалось получить корректный ответ Altegio.');
      }
      if (!Array.isArray(body?.data) || body.success === false) throw new AltegioError('Altegio вернул некорректный каталог услуг.');
      const included = new Map((Array.isArray(body.included) ? body.included : []).map(item => [`${item.type}:${item.id}`, item.attributes]));
      for (const item of body.data) {
        if (!item || typeof item.attributes?.title !== 'string' || !['string', 'number'].includes(typeof item.id)) throw new AltegioError('Altegio вернул некорректную услугу.');
        const id = String(item.id);
        if (seen.has(id)) throw new AltegioError('Altegio повторил страницу каталога. Попробуйте позже.');
        seen.add(id);
        const references = item.relationships?.company_links?.data;
        const links = (Array.isArray(references) ? references : []).map(ref => included.get(`${ref.type}:${ref.id}`)).filter(Boolean);
        const location = links.find(link => String(link.location_id ?? link.company_id) === String(this.locationId));
        const attrs = { ...item.attributes, ...location };
        const service = { id, title: item.attributes.title, price_min: numberOrNull(attrs.price_min), price_max: numberOrNull(attrs.price_max), currency: typeof attrs.currency === 'string' ? attrs.currency : null };
        if (candidates.length <= limit) candidates.push(service);
        if (!item.attributes.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())) continue;
        services.push(service);
        if (services.length > limit) return { services: services.slice(0, limit), truncated: true, query, limit };
      }
      if (body.data.length < this.pageSize) return finish();
    }
    throw new AltegioError('Каталог слишком большой: уточните запрос позже. Полный результат не получен.');
  }
}
