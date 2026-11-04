// Penyimpanan state & log di Upstash Redis lewat REST (tanpa SDK). Env: UPSTASH_REDIS_REST_URL/TOKEN atau KV_REST_API_URL/TOKEN (Vercel Marketplace).
const URL_ = () => process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL, TOKEN = () => process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const PREFIX = process.env.REDIS_PREFIX || 'maudybot:';

async function call(path, body) {
  const r = await fetch(URL_() + path, { method: 'POST', headers: { authorization: 'Bearer ' + TOKEN(), 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error('Redis HTTP ' + r.status);
  return r.json();
}
export const cmd = async (...a) => (await call('/', a)).result;
export const pipeline = async cmds => (await call('/pipeline', cmds)).map(x => { if (x.error) throw new Error(x.error); return x.result; });

export async function getJSON(key, dflt = null) { const v = await cmd('GET', PREFIX + key); return v == null ? dflt : JSON.parse(v); }
export const setJSON = (key, v) => cmd('SET', PREFIX + key, JSON.stringify(v));
// log = list Redis append-only (RPUSH); satu elemen = satu objek JSON
export const logCmd = (name, obj) => ['RPUSH', PREFIX + 'log:' + name, JSON.stringify(obj)];
export async function readLog(name) { return ((await cmd('LRANGE', PREFIX + 'log:' + name, 0, -1)) || []).map(s => JSON.parse(s)); }
export const LOGS = ['calls', 'signals', 'orders', 'equity', 'errors', 'snapshots', 'kill', 'notes'];
export const key = k => PREFIX + k;
