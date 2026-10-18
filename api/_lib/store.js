/**
 * Tiny key-value store. Uses Upstash Redis (free tier) when UPSTASH_REDIS_REST_URL/TOKEN are set,
 * otherwise falls back to process memory. Memory is NOT shared between serverless instances,
 * so set up Upstash in production for chat history, de-duplication and human take-over.
 */
const mem = new Map();

async function upstash(cmd) {
  const r = await fetch(process.env.UPSTASH_REDIS_REST_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd)
  });
  if (!r.ok) throw new Error('upstash ' + r.status);
  return (await r.json()).result;
}
const remote = () => !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);

async function get(key) {
  if (remote()) { const v = await upstash(['GET', key]); return v == null ? null : JSON.parse(v); }
  const e = mem.get(key);
  if (!e) return null;
  if (e.exp && e.exp < Date.now()) { mem.delete(key); return null; }
  return e.val;
}
async function set(key, val, ttlSec) {
  if (remote()) return upstash(ttlSec ? ['SET', key, JSON.stringify(val), 'EX', ttlSec] : ['SET', key, JSON.stringify(val)]);
  mem.set(key, { val, exp: ttlSec ? Date.now() + ttlSec * 1000 : 0 });
}
/** Returns true the first time a key is seen (used to ignore Meta's webhook retries). */
async function firstTime(key, ttlSec = 86400) {
  if (remote()) return (await upstash(['SET', key, '1', 'EX', ttlSec, 'NX'])) === 'OK';
  if (await get(key)) return false;
  await set(key, 1, ttlSec);
  return true;
}
/** Increment a counter (for rate limits). The key expires `ttlSec` after it is first created. */
async function incr(key, ttlSec) {
  if (remote()) {
    const n = await upstash(['INCR', key]);
    if (n === 1) await upstash(['EXPIRE', key, ttlSec]);
    return n;
  }
  const cur = (await get(key)) || 0;
  const e = mem.get(key);
  mem.set(key, { val: cur + 1, exp: e && e.exp ? e.exp : Date.now() + ttlSec * 1000 });
  return cur + 1;
}
function _reset() { mem.clear(); }

module.exports = { get, set, firstTime, incr, _reset };
