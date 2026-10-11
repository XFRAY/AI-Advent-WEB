export function createRateLimiter({ limit, windowMs, now = Date.now }) {
  const buckets = new Map();
  return { consume(key) { const time = now(); let bucket = buckets.get(key); if (!bucket || time >= bucket.resetAt) { bucket = { count: 0, resetAt: time + windowMs }; buckets.set(key, bucket); } bucket.count += 1; const allowed = bucket.count <= limit; return { allowed, remaining: Math.max(0, limit - bucket.count), resetAt: bucket.resetAt, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - time) / 1000)) }; } };
}

export function createRequestQueue({ concurrency = 1, maxQueue = 4 } = {}) {
  let active = 0; const waiting = [];
  async function execute(job) {
    try { const result = await job.action(); active -= 1; drain(); job.resolve(result); }
    catch (error) { active -= 1; drain(); job.reject(error); }
  }
  function drain() { while (active < concurrency && waiting.length) { const job = waiting.shift(); active += 1; void execute(job); } }
  return { canAccept() { return active < concurrency || waiting.length < maxQueue; }, run(action) { if (!this.canAccept()) return Promise.reject(Object.assign(new Error('Очередь заполнена.'), { code: 'QUEUE_FULL' })); return new Promise((resolve, reject) => { waiting.push({ action, resolve, reject }); drain(); }); }, status() { return { active, queued: waiting.length }; } };
}
