// Tarik candle historis Indodax (history_v2) MUNDUR dari sekarang sampai tanggal awal · berurutan, jeda 400 ms (< 3 request/detik), tanpa paralel
// node tools/fetch_history.mjs [tf=240] [mulai=2023-08-01]   →  data/candles_<tf>/<PAIR>.csv  (t = waktu buka candle UTC ISO, o,h,l,c,v)
import fs from 'fs';
const TF = process.argv[2] || '240', FROM = Date.parse((process.argv[3] || '2022-02-01') + 'T00:00:00Z') / 1000;
const PAIRS = ['BTCIDR', 'ETHIDR', 'XRPIDR', 'DOGEIDR', 'TRXIDR', 'VELOIDR', 'ADAIDR', 'BNBIDR'];
const OUT = new URL(`../data/candles_${TF}/`, import.meta.url), sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });
async function getJSON(url, tries = 4) { for (let i = 1; i <= tries; i++) { try { const r = await fetch(url, { signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); } catch (e) { if (i === tries) throw e; await sleep(2000 * i); } } }
for (const sym of PAIRS) { const all = new Map(); let to = Math.floor(Date.now() / 1000), req = 0;
  for (;;) { const d = await getJSON(`https://indodax.com/tradingview/history_v2?symbol=${sym}&tf=${TF}&from=${FROM}&to=${to}`); req++; await sleep(400);
    if (!Array.isArray(d) || !d.length) break; let min = Infinity; for (const b of d) { all.set(b.Time, b); min = Math.min(min, b.Time); }
    if (min <= FROM || min >= to) break; to = min - 1; }
  const rows = [...all.values()].filter(b => b.Time >= FROM).sort((a, b) => a.Time - b.Time);
  fs.writeFileSync(new URL(sym + '.csv', OUT), 't,o,h,l,c,v\n' + rows.map(b => [new Date(b.Time * 1000).toISOString().slice(0, 16), b.Open, b.High, b.Low, b.Close, b.Volume].join(',')).join('\n') + '\n');
  console.log(sym, rows.length, 'bar', rows[0] && new Date(rows[0].Time * 1000).toISOString().slice(0, 16), '→', rows.at(-1) && new Date(rows.at(-1).Time * 1000).toISOString().slice(0, 16), req, 'request'); }
