import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SummaryScheduler } from './scheduler.js';
import { SummaryError } from './money.js';
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'summary-test-'));
  const file = join(dir, 'state.json');
  let date = new Date('2026-09-26T12:00:00Z'), pending, count = 0;
  const api = { locationId: '1', partnerToken: 'partner', userToken: 'user', metadata: async () => ({ title: 'Salon', timezone: 'Europe/Warsaw', currency: 'PLN' }), collect: async ({ now }) => ({ net: String(++count), collectedAt: now.toISOString() }) };
  const make = async () => new SummaryScheduler({ file, api, now: () => date, setTimer: (fn, delay) => { pending = { fn, delay }; return 1; }, clearTimer: () => { pending = null; } }).init();
  const schedulers = [];
  const create = async () => { const scheduler = await make(); schedulers.push(scheduler); return scheduler; };
  t.after(async () => { for (const scheduler of schedulers) await scheduler.stop(); await rm(dir, { recursive: true, force: true }); });
  return { api, file, create, advance: ms => { date = new Date(date.getTime() + ms); }, timer: () => pending, count: () => count };
}
const settle = async scheduler => { await scheduler.active; };
test('immediate run, repeated setting, interval change, periodic run and pause', async t => {
  const f = await fixture(t), s = await f.create();
  await s.set({ intervalMinutes: 1 }); assert.equal(f.count(), 1); assert.equal(f.timer().delay, 60_000);
  await s.set({ intervalMinutes: 1 }); assert.equal(f.count(), 1);
  f.advance(60_000); f.timer().fn(); await settle(s); assert.equal(f.count(), 2);
  await s.set({ intervalMinutes: 5 }); assert.equal(f.count(), 3); assert.equal(f.timer().delay, 300_000);
  await s.pause(); assert.equal(f.timer(), null); assert.equal(s.status().schedule.enabled, false);
  const state = JSON.parse(await readFile(f.file, 'utf8')); assert.equal(state.runs.length, 3);
  assert.doesNotMatch(JSON.stringify(state), /partner|userToken/);
});
test('restart restores results and coalesces missed intervals into one current run', async t => {
  const f = await fixture(t); let s = await f.create();
  await s.set({ intervalMinutes: 1 }); await s.stop(); f.advance(600_000);
  s = await f.create(); assert.equal(s.results().runs.length, 1); assert.equal(f.timer().delay, 0);
  f.timer().fn(); await settle(s); assert.equal(f.count(), 2); assert.equal(f.timer().delay, 60_000);
});
test('parallel collection returns running status; shutdown waits and preserves last result', async t => {
  const f = await fixture(t), s = await f.create(); let release, entered;
  const began = new Promise(resolve => { entered = resolve; });
  f.api.collect = () => { entered(); return new Promise(resolve => { release = resolve; }); };
  const run = s.run(); await began;
  assert.equal((await s.run()).state, 'running');
  let stopped = false; const stop = s.stop().then(() => { stopped = true; });
  await Promise.resolve(); assert.equal(stopped, false);
  release({ net: '42.00' }); await run; await stop;
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).runs[0].summary.net, '42.00');
});
test('auth errors suspend automatic retries, keep previous success and survive connection replacement', async t => {
  const f = await fixture(t); let s = await f.create(); await s.set({ intervalMinutes: 1 });
  const collect = f.api.collect;
  f.api.collect = async () => { throw new SummaryError('Авторизация истекла', 'auth'); };
  await s.run(); assert.equal(s.status().state, 'waiting_connection'); assert.equal(f.timer(), null); assert.equal(s.status().latest.net, '1');
  assert.equal(s.results().runs[0].status, 'error');
  await s.stop(); f.api.collect = collect; s = await f.create();
  assert.ok(f.timer());
  await s.run(); assert.equal(s.status().state, 'scheduled');
});
test('changing location pauses saved task; absent token waits without collecting', async t => {
  const f = await fixture(t); let s = await f.create(); await s.set({}); await s.stop();
  f.api.locationId = '2'; s = await f.create(); assert.equal(s.status().schedule.enabled, false); assert.equal(f.timer(), null);
  await s.set({}); assert.equal(s.status().schedule.locationId, '2'); await s.stop();
  delete f.api.userToken; s = await f.create(); assert.equal(s.status().state, 'waiting_connection'); assert.equal(f.timer(), null);
});
test('missing timezone requires explicit setting and corrupted JSON is never overwritten', async t => {
  const f = await fixture(t); let s = await f.create();
  f.api.metadata = async () => ({ title: 'Salon', timezone: null, currency: null });
  await assert.rejects(s.set({}), /часовой пояс/);
  await s.set({ timezone: 'Europe/Warsaw' }); assert.equal(s.status().schedule.timezone, 'Europe/Warsaw');
  await s.stop(); await writeFile(f.file, '{broken');
  await assert.rejects(f.create(), /повреждено/); assert.equal(await readFile(f.file, 'utf8'), '{broken');
});
test('single writer lock prevents simultaneous owners', async t => {
  const f = await fixture(t); await f.create(); await assert.rejects(f.create(), /другим процессом/);
});
test('interrupted run becomes a saved error on recovery', async t => {
  const f = await fixture(t), s = await f.create(); await s.stop();
  await writeFile(f.file, JSON.stringify({ version: 1, schedule: null, runs: [{ id: 'interrupted', status: 'running', startedAt: '2026-09-26T10:00:00Z', locationId: '1' }] }));
  const restored = await f.create(); assert.equal(restored.results().runs[0].status, 'error');
});
test('explicit timezone persists across runs even when API metadata differs', async t => {
  const f = await fixture(t), s = await f.create();
  await s.set({ timezone: 'America/New_York' }); await s.run();
  assert.equal(s.status().schedule.timezone, 'America/New_York');
});
test('pause during configuration waits for active work and cannot be overwritten by enable', async t => {
  const f = await fixture(t), s = await f.create(); let release;
  f.api.metadata = () => new Promise(resolve => { release = resolve; });
  const enable = s.set({ intervalMinutes: 1 }); const pause = s.pause();
  release({ title: 'Salon', timezone: 'Europe/Warsaw', currency: 'PLN' });
  await enable; await pause;
  assert.equal(s.status().schedule.enabled, false); assert.equal(f.timer(), null);
});
test('clear history wipes results, latest and schedule across restart but keeps Altegio credentials', async t => {
  const f = await fixture(t); let s = await f.create();
  await s.set({ intervalMinutes: 5 });
  const credentials = { userToken: f.api.userToken, partnerToken: f.api.partnerToken, locationId: f.api.locationId };
  await s.clearHistory();
  assert.deepEqual(s.results().runs, []); assert.equal(s.status().latest, null);
  assert.equal(s.status().schedule, null); assert.equal(s.status().state, 'paused'); assert.equal(f.timer(), null);
  assert.deepEqual({ userToken: f.api.userToken, partnerToken: f.api.partnerToken, locationId: f.api.locationId }, credentials);
  await s.stop(); s = await f.create();
  assert.deepEqual(s.results().runs, []); assert.equal(s.status().schedule, null);
});
test('clear history waits for active collection so its result cannot reappear', async t => {
  const f = await fixture(t), s = await f.create(); let release, entered;
  const began = new Promise(resolve => { entered = resolve; });
  f.api.collect = () => { entered(); return new Promise(resolve => { release = resolve; }); };
  const run = s.run(); await began;
  const clear = s.clearHistory();
  release({ net: '42.00' }); await run; await clear;
  assert.deepEqual(s.results().runs, []);
  assert.deepEqual(JSON.parse(await readFile(f.file, 'utf8')).runs, []);
});
