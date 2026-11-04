// Uji lokal /api/tick tanpa Vercel: Redis REST tiruan di memori (SET/GET/RPUSH/LRANGE/DEL/NX/EX) + API Indodax sungguhan.
// node tools/tes_lokal.mjs   → 2 panggilan berturut-turut (yang kedua harus CANDLE_SUDAH_DIPROSES = idempotency)
import http from 'http';
const db = new Map(), run = a => { const [c, k, ...r] = a.map(String); switch (c.toUpperCase()) {
  case 'GET': return db.has(k) ? db.get(k) : null; case 'SET': if (r.includes('NX') && db.has(k)) return null; db.set(k, r[0]); return 'OK';
  case 'DEL': return db.delete(k) ? 1 : 0; case 'RPUSH': { const l = db.get(k) || []; l.push(...r); db.set(k, l); return l.length; }
  case 'LRANGE': return (db.get(k) || []).slice(+r[0], +r[1] === -1 ? undefined : +r[1] + 1); default: throw new Error('cmd ' + c); } };
const srv = http.createServer((q, s) => { let b = ''; q.on('data', d => b += d); q.on('end', () => { const j = JSON.parse(b), out = q.url === '/pipeline' ? j.map(a => ({ result: run(a) })) : { result: run(j) }; s.end(JSON.stringify(out)); }); });
await new Promise(r => srv.listen(8799, r));
Object.assign(process.env, { UPSTASH_REDIS_REST_URL: 'http://127.0.0.1:8799', UPSTASH_REDIS_REST_TOKEN: 'lokal', CRON_SECRET: 'tes-lokal' });
const tick = (await import('../api/tick.js')).default, state = (await import('../api/state.js')).default;
const call = (h, query = {}) => new Promise(r => h({ headers: { authorization: 'Bearer tes-lokal', 'user-agent': 'tes-lokal' }, query }, { _h: {}, setHeader() {}, status(c) { return { json: j => r({ c, j }) }; } }));
for (let i = 1; i <= 2; i++) { const { c, j } = await call(tick, { sumber: 'tes' + i }); console.log('panggilan', i, c, JSON.stringify(j).slice(0, 700)); }
const { j } = await call(state); console.log('log:', Object.fromEntries(Object.entries(j.log).map(([k, v]) => [k, v.length])), 'state:', JSON.stringify(j.state).slice(0, 300));
console.log('error contoh:', JSON.stringify(j.log.errors.slice(0, 3)));
srv.close();
