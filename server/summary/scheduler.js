import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { SummaryError } from './money.js';
import { timezoneSchema } from './tools.js';
const scheduleSchema = z.object({ enabled: z.boolean(), intervalMinutes: z.number().int().min(1).max(1440), locationId: z.string(), timezone: timezoneSchema, title: z.string(), currency: z.string().nullable(), nextRunAt: z.string().datetime().nullable() });
const stateSchema = z.object({ version: z.literal(1), schedule: scheduleSchema.nullable(), runs: z.array(z.object({ id: z.string(), status: z.enum(['running', 'success', 'error']), startedAt: z.string(), locationId: z.string() }).passthrough()) });
export class SummaryScheduler {
  constructor({ api, file, now = () => new Date(), setTimer = setTimeout, clearTimer = clearTimeout }) {
    Object.assign(this, { api, file, now, setTimer, clearTimer });
    this.state = { version: 1, schedule: null, runs: [] };
    this.queue = Promise.resolve(); this.active = null; this.timer = null; this.stopped = false; this.waiting = null;
  }
  async init() {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    this.lock = `${this.file}.lock`;
    try { await writeFile(this.lock, String(process.pid), { flag: 'wx', mode: 0o600 }); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const pid = Number(await readFile(this.lock, 'utf8'));
      if (!Number.isInteger(pid) || pid <= 0) throw new SummaryError('Некорректная блокировка хранилища сводок.');
      try { process.kill(pid, 0); throw new SummaryError('Хранилище сводок уже используется другим процессом.'); }
      catch (e) { if (e.code !== 'ESRCH') throw e; }
      await unlink(this.lock);
      await writeFile(this.lock, String(process.pid), { flag: 'wx', mode: 0o600 });
    }
    this.ownsLock = true;
    try {
      try { this.state = stateSchema.parse(JSON.parse(await readFile(this.file, 'utf8'))); }
      catch (error) { if (error.code !== 'ENOENT') throw new SummaryError('Хранилище сводок повреждено. Файл сохранён без изменений.'); }
      for (const run of this.state.runs) if (run.status === 'running') Object.assign(run, { status: 'error', error: 'Сбор прерван перезапуском сервера.', finishedAt: this.now().toISOString() });
      if (this.state.schedule && this.api.locationId && this.state.schedule.locationId !== String(this.api.locationId)) { this.state.schedule.enabled = false; this.state.schedule.nextRunAt = null; }
      await this.save();
      this.arm();
      return this;
    } catch (error) { await this.release(); throw error; }
  }
  save() {
    const snapshot = JSON.stringify(this.state, null, 2);
    const operation = this.queue.then(async () => {
      const temp = `${this.file}.${process.pid}.tmp`;
      await writeFile(temp, snapshot, { mode: 0o600 });
      await rename(temp, this.file);
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  status() {
    const ready = this.api.userToken && this.api.partnerToken && this.api.locationId;
    return { locationId: this.api.locationId ? String(this.api.locationId) : null, schedule: this.state.schedule, state: this.active ? 'running' : !ready || this.waiting ? 'waiting_connection' : this.state.schedule?.enabled ? 'scheduled' : 'paused', error: this.waiting,
      latest: [...this.state.runs].reverse().find(run => run.status === 'success')?.summary ?? null };
  }
  results({ limit = 20 } = {}) { return { runs: this.state.runs.slice(-limit).reverse() }; }
  async clearHistory() {
    while (this.active) await this.active.catch(() => {});
    this.clearTimer(this.timer); this.timer = null;
    // Resets the whole summary store (schedule + runs). Altegio credentials live elsewhere and stay intact.
    const previous = { state: this.state, waiting: this.waiting };
    this.state = { version: 1, schedule: null, runs: [] }; this.waiting = null;
    this.active = this.save().catch(error => { ({ state: this.state, waiting: this.waiting } = previous); throw error; })
      .finally(() => { this.active = null; this.arm(); });
    await this.active;
    return this.status();
  }
  arm() {
    this.clearTimer(this.timer); this.timer = null;
    const schedule = this.state.schedule;
    if (this.stopped || this.active || !schedule?.enabled || this.waiting || !this.api.userToken || !this.api.partnerToken || !this.api.locationId) return;
    const delay = Math.max(0, Date.parse(schedule.nextRunAt) - this.now().getTime());
    this.timer = this.setTimer(() => { this.run().catch(() => { this.waiting = 'Не удалось сохранить состояние задачи. Проверьте хранилище.'; }); }, delay);
    this.timer?.unref?.();
  }
  async configuration(timezone) {
    const metadata = await this.api.metadata();
    const existing = this.state.schedule?.locationId === String(this.api.locationId) ? this.state.schedule : null;
    const resolved = timezone ?? existing?.timezone ?? metadata.timezone;
    if (!timezoneSchema.safeParse(resolved).success) throw new SummaryError('Укажите часовой пояс филиала (IANA), например Europe/Warsaw.', 'timezone');
    return { locationId: String(this.api.locationId), timezone: resolved, title: metadata.title, currency: metadata.currency };
  }
  set({ intervalMinutes = 60, timezone } = {}) {
    if (this.active) return Promise.resolve(this.status());
    if (this.stopped) return Promise.reject(new SummaryError('Планировщик останавливается.'));
    this.clearTimer(this.timer); this.timer = null;
    this.active = (async () => {
      const config = await this.configuration(timezone);
      const old = this.state.schedule;
      if (old?.enabled && old.intervalMinutes === intervalMinutes && old.locationId === config.locationId && old.timezone === config.timezone && !this.waiting) return { ...this.status(), state: 'scheduled' };
      this.state.schedule = { ...config, enabled: true, intervalMinutes, nextRunAt: this.now().toISOString() };
      this.waiting = null;
      await this.save();
      return this.execute({ configuration: config });
    })().finally(() => { this.active = null; this.arm(); });
    return this.active;
  }
  async pause() {
    await this.active?.catch(() => {});
    this.clearTimer(this.timer); this.timer = null;
    if (this.state.schedule) { this.state.schedule.enabled = false; this.state.schedule.nextRunAt = null; }
    await this.save();
    return this.status();
  }
  run(args = {}) {
    if (this.active) return Promise.resolve(this.status());
    if (this.stopped) return Promise.reject(new SummaryError('Планировщик останавливается.'));
    this.clearTimer(this.timer); this.timer = null;
    this.active = this.execute(args).finally(() => { this.active = null; this.arm(); });
    return this.active;
  }
  async execute({ timezone, configuration } = {}) {
    const run = { id: randomUUID(), status: 'running', startedAt: this.now().toISOString(), locationId: String(this.api.locationId || '') };
    this.state.runs.push(run);
    await this.save();
    try {
      const config = configuration ?? await this.configuration(timezone);
      const summary = await this.api.collect({ ...config, now: this.now() });
      Object.assign(run, { status: 'success', summary }); this.waiting = null;
      if (this.state.schedule?.locationId === config.locationId) Object.assign(this.state.schedule, config);
    } catch (error) {
      run.status = 'error'; run.error = error instanceof SummaryError ? error.message : 'Не удалось собрать сводку.';
      if (error instanceof SummaryError && ['auth', 'access', 'location', 'timezone'].includes(error.code)) this.waiting = run.error;
    }
    run.finishedAt = this.now().toISOString();
    const schedule = this.state.schedule;
    if (schedule?.enabled) schedule.nextRunAt = new Date(this.now().getTime() + schedule.intervalMinutes * 60_000).toISOString();
    await this.save();
    return { ...this.status(), state: this.waiting ? 'waiting_connection' : schedule?.enabled ? 'scheduled' : 'paused', run };
  }
  async release() { if (this.ownsLock) { await unlink(this.lock); this.ownsLock = false; } }
  async stop({ pause = false } = {}) {
    this.stopped = true; this.clearTimer(this.timer);
    if (pause) await this.pause();
    await this.active?.catch(() => {});
    await this.queue;
    await this.release();
  }
}
