import { fileURLToPath } from 'node:url';
import { defaultServers } from '../mcp/registry.js';
export const fixture = name => fileURLToPath(new URL(`./${name}.js`, import.meta.url));
// All four servers as real processes; altegio and currency talk to substituted upstream HTTP.
export const testServers = (overrides = {}) => ({
  ...defaultServers,
  altegio: { ...defaultServers.altegio, path: fixture('altegio-fixture') },
  currency: { ...defaultServers.currency, path: fixture('currency-fixture') },
  ...overrides,
});
