// A real currency MCP child process; only the NBP HTTP API is substituted.
import { createCurrencyServer } from '../mcp/servers/currency/server.js';
import { NbpRates } from '../mcp/servers/currency/nbp.js';
import { serveStdio } from '../mcp/servers/shared.js';
const mids = { eur: 4.25, usd: 4 };
const rates = new NbpRates({ fetchImpl: async url => {
  const code = new URL(url).pathname.split('/')[5];
  return mids[code] ? Response.json({ rates: [{ mid: mids[code], effectiveDate: '2026-09-25' }] }) : new Response('Not Found', { status: 404 });
} });
await serveStdio(createCurrencyServer({ rates }));
