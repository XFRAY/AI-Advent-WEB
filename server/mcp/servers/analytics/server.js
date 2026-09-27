import { priceStats } from './stats.js';
import { analyticsTools } from './tools.js';
import { createToolServer, isMain, serveStdio } from '../shared.js';

export const createAnalyticsServer = () => createToolServer({
  name: 'analytics', definitions: analyticsTools,
  handlers: { analytics_price_stats: ({ items }) => priceStats(items) },
});
if (isMain(import.meta)) await serveStdio(createAnalyticsServer());
