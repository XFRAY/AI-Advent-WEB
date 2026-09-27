import { z } from 'zod';
const code = z.string().trim().regex(/^[A-Za-z]{3}$/);
export const currencyTools = {
  currency_convert: {
    description: 'Пересчитывает суммы из одной валюты в другую по среднему курсу Национального банка Польши (таблица A, кросс-курс через PLN). Возвращает курс, дату курса и пересчитанные суммы в том же порядке.',
    schema: z.object({
      from: code.describe('Исходная валюта, ISO 4217, например PLN.'),
      to: code.describe('Целевая валюта, ISO 4217, например EUR.'),
      amounts: z.array(z.number().nonnegative().finite()).min(1).max(200).describe('Суммы в исходной валюте.'),
    }).strict(),
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
};
