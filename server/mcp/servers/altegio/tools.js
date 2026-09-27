import { inputSchema } from './api.js';
export const altegioTools = {
  altegio_search_services: {
    description: 'Ищет услуги выбранного филиала Altegio по названию. Возвращает services: id, title, price_min, price_max, currency (ISO-код; если у услуги своей валюты нет — валюта филиала, например PLN). Единственный источник услуг и цен.',
    schema: inputSchema,
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
};
