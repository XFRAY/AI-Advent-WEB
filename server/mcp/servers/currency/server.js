import { NbpRates } from './nbp.js';
import { currencyTools } from './tools.js';
import { createToolServer, isMain, serveStdio } from '../shared.js';

export const createCurrencyServer = ({ rates = new NbpRates() } = {}) => createToolServer({
  name: 'currency', definitions: currencyTools,
  handlers: { currency_convert: args => rates.convert(args) },
});
if (isMain(import.meta)) await serveStdio(createCurrencyServer());
