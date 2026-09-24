export class AltegioAuthError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

export async function authorizeAltegio({ login, password, partnerToken, fetchImpl = globalThis.fetch }) {
  if (typeof login !== 'string' || !login.trim() || login.length > 320 || typeof password !== 'string' || !password || password.length > 1024) {
    throw new AltegioAuthError('Введите логин и пароль Altegio.', 400);
  }
  if (!partnerToken) throw new AltegioAuthError('На сервере не настроен ALTEGIO_PARTNER_TOKEN.', 503);
  try {
    const response = await fetchImpl('https://api.alteg.io/api/v1/auth', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${partnerToken}`, Accept: 'application/vnd.api.v2+json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: login.trim(), password }),
    });
    if ([400, 401, 403, 422].includes(response.status)) throw new AltegioAuthError('Не удалось войти. Проверьте логин, пароль и доступ к Altegio.', 401);
    if (response.status === 429) throw new AltegioAuthError('Слишком много попыток входа. Повторите позже.', 429);
    if (!response.ok) throw new AltegioAuthError('Сервис авторизации Altegio временно недоступен.');
    const body = await response.json();
    if (body.success === false || typeof body.data?.user_token !== 'string' || !body.data.user_token.trim()) throw new AltegioAuthError('Altegio не вернул токен авторизации.');
    return body.data.user_token;
  } catch (error) {
    if (error instanceof AltegioAuthError) throw error;
    if (['TimeoutError', 'AbortError'].includes(error.name)) throw new AltegioAuthError('Истекло время ожидания входа. Повторите попытку.', 504);
    throw new AltegioAuthError('Не удалось подключиться к сервису авторизации Altegio.');
  }
}

export async function listAltegioLocations({ partnerToken, userToken, fetchImpl = globalThis.fetch, pageSize = 100 }) {
  const locations = [];
  const seen = new Set();
  const signal = AbortSignal.timeout(15_000);
  try {
    for (let page = 1; page <= 100; page++) {
      const url = new URL('https://api.alteg.io/api/v1/companies');
      url.searchParams.set('my', '1');
      url.searchParams.set('page', String(page));
      url.searchParams.set('count', String(pageSize));
      const response = await fetchImpl(url, { headers: {
        Authorization: `Bearer ${partnerToken}, User ${userToken}`,
        Accept: 'application/vnd.api.v2+json', 'Content-Type': 'application/json',
      }, signal, redirect: 'error' });
      if (!response.ok) throw new AltegioAuthError(response.status === 401 ? 'Авторизация истекла. Выйдите и войдите снова.' : 'Не удалось загрузить доступные филиалы. Повторите попытку.');
      const body = await response.json();
      if (body.success === false || !Array.isArray(body.data)) throw new AltegioAuthError('Altegio вернул некорректный список филиалов.');
      for (const item of body.data) {
        const id = String(item?.id ?? '');
        if (!/^[1-9]\d*$/.test(id) || typeof item.title !== 'string' || seen.has(id)) throw new AltegioAuthError('Altegio вернул некорректный список филиалов.');
        seen.add(id);
        locations.push({ id, title: item.title, address: typeof item.address === 'string' ? item.address : '' });
      }
      if (body.data.length < pageSize) return locations;
    }
    throw new AltegioAuthError('Не удалось загрузить полный список филиалов.');
  } catch (error) {
    if (error instanceof AltegioAuthError) throw error;
    throw new AltegioAuthError('Не удалось загрузить филиалы. Проверьте подключение и повторите попытку.');
  }
}
