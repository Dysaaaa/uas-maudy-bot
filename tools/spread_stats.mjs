// Median setengah-spread dan slippage per pasangan dari SEMUA snapshot order book mentah: laptop (data/snapshots/*.jsonl) + bot Vercel (data/forward/state.json)
// slippage = harga rata-rata menghabiskan level order book untuk order Rp ORDER dibanding best ask/bid
// node tools/spread_stats.mjs [ORDER=15000000] [sampai=YYYY-MM-DDTHH:MM]  →  data/spread_median.json
import fs from 'fs';
const ORDER = +(process.argv[2] || 15e6), UNTIL = process.argv[3] ? Date.parse(process.argv[3] + 'Z') : Infinity, DIR = new URL('../data/snapshots/', import.meta.url);
const walk = (lv, idr) => { let left = idr, q = 0, cost = 0; for (const [p, a] of lv) { const px = +p, v = Math.min(left, px * +a); q += v / px; cost += v; left -= v; if (left <= 1e-6) break; } return left > 1e-6 ? NaN : cost / q; };
const by = {};
for (const f of fs.readdirSync(DIR).filter(f => f.endsWith('.jsonl')).sort()) for (const line of fs.readFileSync(new URL(f, DIR), 'utf8').split('\n')) { if (!line.trim()) continue;
  const s = JSON.parse(line); if (s.error || !s.bids?.length || !s.asks?.length || s.t_local > UNTIL) continue; const bid = +s.bids[0][0], ask = +s.asks[0][0], mid = (bid + ask) / 2;
  const buy = walk(s.asks, ORDER), sell = walk(s.bids, ORDER); (by[s.pair] ??= []).push({ hs: (ask - bid) / mid / 2, sb: buy / ask - 1, ss: 1 - sell / bid }); }
// snapshot yang disimpan bot di Vercel (hasil tools/ekspor_log.mjs → data/forward/state.json), format { t, pair (BTCIDR), bids, asks }
const VF = new URL('../data/forward/state.json', import.meta.url);
if (fs.existsSync(VF)) for (const s of JSON.parse(fs.readFileSync(VF, 'utf8')).log.snapshots || []) { if (!s.bids?.length || !s.asks?.length || Date.parse(s.t) > UNTIL) continue;
  const bid = +s.bids[0][0], ask = +s.asks[0][0], mid = (bid + ask) / 2, buy = walk(s.asks, ORDER), sell = walk(s.bids, ORDER); (by[s.pair.toLowerCase()] ??= []).push({ hs: (ask - bid) / mid / 2, sb: buy / ask - 1, ss: 1 - sell / bid }); }
const med = a => { const x = a.filter(Number.isFinite).sort((p, q) => p - q); return x.length ? x[x.length >> 1] : NaN; };
const out = { order_idr: ORDER, dibuat: new Date().toISOString(), pasangan: {} };
for (const [p, A] of Object.entries(by)) out.pasangan[p] = { n: A.length, half_spread: med(A.map(x => x.hs)), slip_beli: med(A.map(x => x.sb)), slip_jual: med(A.map(x => x.ss)) };
fs.writeFileSync(new URL('../data/spread_median.json', import.meta.url), JSON.stringify(out, null, 1));
for (const [p, x] of Object.entries(out.pasangan)) console.log(p.padEnd(8), 'n', x.n, 'setengah spread', (x.half_spread * 100).toFixed(3) + '%', 'slip beli', (x.slip_beli * 100).toFixed(3) + '%', 'slip jual', (x.slip_jual * 100).toFixed(3) + '%');
