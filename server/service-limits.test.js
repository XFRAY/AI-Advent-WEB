import test from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter, createRequestQueue } from './service-limits.js';

test('rate limiter isolates keys and resets its fixed window', () => {
  let now = 0; const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: () => now });
  assert.equal(limiter.consume('a').allowed, true); assert.equal(limiter.consume('a').remaining, 0); assert.equal(limiter.consume('a').allowed, false); assert.equal(limiter.consume('b').allowed, true);
  now = 1000; assert.equal(limiter.consume('a').allowed, true);
});

test('queue continues after a rejected job', async () => {
  const queue = createRequestQueue({ concurrency: 1, maxQueue: 1 });
  await assert.rejects(queue.run(async () => { throw new Error('fail'); }), /fail/);
  assert.equal(await queue.run(async () => 'ok'), 'ok'); assert.deepEqual(queue.status(), { active: 0, queued: 0 });
});
