// BACKTEST Dysa (Breakout Hybrid + filter BTC) 4 jam — memanggil decide(), validateBars() dan cutWindow() yang SAMA dengan bot, candle demi candle.
// Keputusan di close bar t → eksekusi di OPEN bar t+1: beli = open × (1 + setengah spread + slippage beli), jual = open × (1 − setengah spread − slippage jual)
// (median terukur dari snapshot order book, data/spread_median.json) + fee taker all-in. Ekuitas dinilai di close × (1 − setengah spread) ≈ best bid.
// Validasi order book bot (spread > 2%) diganti median spread terukur per pasangan. Daily loss limit memakai hari WIB (UTC+7). Modal Rp100 jt, long-only, tanpa margin.
// node tools/backtest.mjs [mulai=2023-11-01] [akhir=9999] [--trades out.csv] [--sinyal out.csv] [--ekuitas out.csv] [--ringkasan out.json]
import fs from 'fs';
import { PARAMS, decide, monthOf } from '../lib/strategy.js';
import { COSTS } from '../lib/costs.js';
import { PAIRS, validateBars, cutWindow, MAX_SPREAD } from '../lib/indodax.js';
import { tradeStats, equityStats } from '../public/metrics.js';
const A = process.argv.slice(2), opt = k => { const i = A.indexOf(k); return i >= 0 ? A[i + 1] : null; }, pos_ = A.filter((x, i) => !x.startsWith('--') && !(i > 0 && A[i - 1].startsWith('--')));
const ts_ = (x, d, z) => !x ? d : x.length > 10 ? x.slice(0, 16) : x + z;   // terima tanggal (YYYY-MM-DD) atau candle (YYYY-MM-DDTHH:MM)
const START = ts_(pos_[0], '2023-11-01T00:00', 'T00:00'), END = ts_(pos_[1], '9999', 'T99'), MODAL = 100e6, TF = PARAMS.tf * 60e3;
const DIR = new URL(`../data/candles_${PARAMS.tf}/`, import.meta.url), SPR = JSON.parse(fs.readFileSync(new URL('../data/spread_median.json', import.meta.url), 'utf8')).pasangan;
const now = Date.now(), bars = {};
for (const pair of PAIRS) bars[pair] = fs.readFileSync(new URL(pair + '.csv', DIR), 'utf8').trim().split('\n').slice(1).map(l => { const [t, o, h, l2, c, v] = l.split(','); return { t, o: +o, h: +h, l: +l2, c: +c, v: +v }; })
  .filter(b => Date.parse(b.t + 'Z') + TF <= now);   // hanya candle tertutup
const T = [...new Set(bars.BTCIDR.map(x => x.t))].sort(), idx = Object.fromEntries(PAIRS.map(p => [p, new Map(bars[p].map((x, i) => [x.t, i]))]));   // candle keputusan = candle BTC (sama dengan bot)
const spr = pair => { const s = SPR[pair.toLowerCase()]; if (!s) throw new Error('median spread tidak ada untuk ' + pair + ' — jalankan tools/spread_stats.mjs'); return s; };
const cost = (pair, side) => spr(pair).half_spread + (side === 'buy' ? spr(pair).slip_beli : spr(pair).slip_jual);
const wibDay = t => new Date(Date.parse(t + 'Z') + 7 * 3600e3 + TF).toISOString().slice(0, 10);   // hari WIB saat candle TUTUP
const memo = { exM: {}, pend: {} }; let cash = MODAL, positions = [], dayStart = null, dayKey = null, pending = null; const trades = [], curve = [], sig = [];
const value = t => positions.reduce((s, p) => { const i = idx[p.pair].get(t); const c = i != null ? bars[p.pair][i].c : p.last; p.last = c; return s + p.qty * c * (1 - spr(p.pair).half_spread); }, 0);
for (let k = 0; k < T.length; k++) { const t = T[k];
  // 1) eksekusi keputusan bar sebelumnya di OPEN bar ini (pasangan tanpa bar di jam ini: order dieksekusi di bar berikutnya yang ada)
  if (pending) { const later = { exits: [], entries: [] };
    for (const x of pending.exits) { const p = positions.find(q => q.pair === x.pair), i = idx[x.pair].get(t); if (!p) continue; if (i == null) { later.exits.push(x); continue; }
      const o = bars[x.pair][i].o, px = o * (1 - cost(x.pair, 'sell')), gross = p.qty * px, fee = gross * COSTS.feeSell;
      cash += gross - fee; trades.push({ pair: p.pair, masuk: p.tE, keluar: t, harga_masuk: p.entryPrice, harga_keluar: px, qty: p.qty, beli: p.cost, jual: gross - fee, pnl: gross - fee - p.cost, ret: (gross - fee) / p.cost - 1, alasan: x.reason,
        biaya: p.feeB + fee + p.qty * (o - px) + p.spB }); positions = positions.filter(q => q !== p); memo.exM[x.pair] = monthOf(Date.parse(t + 'Z')); memo.pend[x.pair] = 1; }
    const eq0 = cash + value(t);
    for (const x of pending.entries) { const i = idx[x.pair].get(t); if (positions.some(q => q.pair === x.pair)) continue; if (i == null) { later.entries.push(x); continue; }
      const o = bars[x.pair][i].o, px = o * (1 + cost(x.pair, 'buy'));
      const idr = Math.min(x.weight * eq0, PARAMS.maxPosValue * eq0, cash / (1 + COSTS.feeBuy)); if (idr < COSTS.minOrderIDR) continue;
      const qty = idr / px, fee = idr * COSTS.feeBuy; cash -= idr + fee;
      delete memo.pend[x.pair]; positions.push({ pair: x.pair, tE: t, entryPrice: px, qty, cost: idr + fee, feeB: fee, spB: qty * (px - o), last: o }); }
    pending = later.exits.length || later.entries.length ? later : null; }
  // 2) ekuitas di close bar ini + batas hari WIB
  const eq = cash + value(t), dk = wibDay(t); if (dk !== dayKey) { dayKey = dk; dayStart = eq; }
  if (t >= START && t <= END) curve.push({ t, eq, n: positions.length });
  if (t < START || t > END || k === T.length - 1) continue;
  // 3) keputusan di close bar ini: jendela candle tertutup & validasi yang sama dengan bot (waktu panggilan = tutup candle)
  const win = {}, noEntry = new Set(), closeMs = Date.parse(t + 'Z') + TF;
  for (const pair of PAIRS) { const i = idx[pair].get(t); if (i == null) continue; win[pair] = cutWindow(bars[pair].slice(Math.max(0, i - PARAMS.window), i + 1), t, PARAMS.window, PARAMS.tf);
    if (validateBars(win[pair], PARAMS.tf, closeMs, PARAMS.warmup).length || 2 * spr(pair).half_spread > MAX_SPREAD) noEntry.add(pair); }
  const blocked = eq <= dayStart * (1 - PARAMS.dailyLoss), d = decide(win, positions.map(p => ({ pair: p.pair, entryPrice: p.entryPrice })), { blocked, noEntry, memo });
  for (const x of d.exits) sig.push([t, x.pair, 'JUAL', x.reason, x.signalPrice]); for (const x of [...d.entries, ...d.rejected]) sig.push([t, x.pair, 'BELI', x.reason, x.signalPrice]);
  if (pending) { pending.exits.push(...d.exits); pending.entries.push(...d.entries); } else pending = { exits: d.exits, entries: d.entries }; }
// ---- metrik (definisi sama dengan dashboard, public/metrics.js)
const C = curve, X = trades.filter(t => t.masuk >= START && t.keluar <= END), ts = tradeStats(X), es = equityStats(C, { cagr: true });
const btc = bars.BTCIDR, b0 = btc.find(b => b.t >= START), b1 = btc.filter(b => b.t <= END).at(-1); let bp = b0.c, bdd = 0; for (const b of btc) if (b.t >= START && b.t <= END) { bp = Math.max(bp, b.c); bdd = Math.max(bdd, 1 - b.c / bp); }
const pc = x => x == null ? '–' : (x * 100).toFixed(2) + '%', ditolak = sig.filter(s => s[3].endsWith('TIDAK_VALID')).length;
console.log(`BACKTEST ${C[0].t} → ${C.at(-1).t} UTC (${es.tahun.toFixed(2)} thn) · ${PAIRS.length} pasangan · fee ${pc(COSTS.feeBuy)}/${pc(COSTS.feeSell)} + spread & slippage terukur`);
console.log(`return total ${pc(es.return_total)} · CAGR ${pc(es.cagr)} · MDD -${pc(es.mdd)} · trade ${ts.jumlah} · WR ${pc(ts.win_rate)} · PF ${ts.profit_factor?.toFixed(2)} · rata2 untung ${pc(ts.rata_untung)} / rugi ${pc(ts.rata_rugi)} · porsi biaya ${pc(ts.porsi_biaya)} (Σ biaya ÷ Σ hasil sebelum biaya)`);
console.log(`beli & tahan BTC/IDR: ${pc(b1.c / b0.c - 1)} · MDD -${pc(bdd)} · sinyal beli ditolak validasi data: ${ditolak}`);
for (const p of PAIRS) { const Z = X.filter(t => t.pair === p); if (Z.length) { const s = tradeStats(Z); console.log(`  ${p.padEnd(8)} ${String(Z.length).padStart(4)} trade · WR ${pc(s.win_rate)} · PF ${s.profit_factor?.toFixed(2)} · laba ${(s.laba_bersih / 1e6).toFixed(1)} jt`); } }
const yrs = {}; let prev = C[0].eq; for (const x of C) { const yy = x.t.slice(0, 4); yrs[yy] ??= { a: prev }; yrs[yy].b = x.eq; prev = x.eq; } console.log('  per tahun: ' + Object.entries(yrs).map(([k, v]) => `${k} ${pc(v.b / v.a - 1)}`).join(' · '));
if (opt('--ringkasan')) fs.writeFileSync(opt('--ringkasan'), JSON.stringify({ dibuat: new Date().toISOString(), mulai: C[0].t, akhir: C.at(-1).t, fee: { beli: COSTS.feeBuy, jual: COSTS.feeSell }, spread_median: SPR,
  ekuitas: es, trade: ts, beli_tahan_btc: { return_total: b1.c / b0.c - 1, mdd: bdd }, sinyal_beli_ditolak: ditolak, per_pasangan: Object.fromEntries(PAIRS.map(p => [p, tradeStats(X.filter(t => t.pair === p))])) }, null, 1));
if (opt('--trades')) fs.writeFileSync(opt('--trades'), 'pair,masuk,keluar,harga_masuk,harga_keluar,qty,nilai_beli,nilai_jual,pnl,ret,alasan,biaya\n' + X.map(t => [t.pair, t.masuk, t.keluar, t.harga_masuk, t.harga_keluar, t.qty, t.beli.toFixed(0), t.jual.toFixed(0), t.pnl.toFixed(0), t.ret.toFixed(5), t.alasan, t.biaya.toFixed(0)].join(',')).join('\n'));
if (opt('--sinyal')) fs.writeFileSync(opt('--sinyal'), 'candle_t,pair,sisi,alasan,harga_sinyal\n' + sig.map(r => r.join(',')).join('\n'));
if (opt('--ekuitas')) fs.writeFileSync(opt('--ekuitas'), 't,ekuitas,posisi\n' + C.map(x => [x.t, x.eq.toFixed(0), x.n].join(',')).join('\n'));
