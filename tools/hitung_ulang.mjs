// HITUNG ULANG semua angka dashboard dari log mentah + backtest ulang di jendela forward yang sama (candle sama), lalu tulis dashboard offline.
// Urutan: node tools/ekspor_log.mjs → node tools/fetch_history.mjs 240 2022-02-01 → node tools/hitung_ulang.mjs
// Keluaran: data/hasil_hitung_ulang.json, public/hasil_hitung_ulang.json (dibaca dashboard Vercel), dashboard_offline.html (mandiri, tanpa internet)
import fs from 'fs';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { forwardFromLogs, equityStats, cocokkanSinyal, TF_MS } from '../public/metrics.js';
const R = p => new URL('../' + p, import.meta.url), FP = p => fileURLToPath(R(p)), node = process.execPath;
const state = JSON.parse(fs.readFileSync(R('data/forward/state.json'), 'utf8')), bt = JSON.parse(fs.readFileSync(R('public/backtest_ringkasan.json'), 'utf8'));
const fw = forwardFromLogs(state, process.env.UJI_FREEZE ? { freeze: process.env.UJI_FREEZE } : {});   // UJI_FREEZE hanya untuk uji alur sebelum freeze
// ---- 1) backtest penuh dijalankan ulang dengan akhir yang sama → harus sama dengan public/backtest_ringkasan.json
execFileSync(node, [FP('tools/backtest.mjs'), bt.mulai, bt.akhir, '--ringkasan', FP('data/forward/bt_ulang_ringkasan.json')], { stdio: 'ignore' });
const btU = JSON.parse(fs.readFileSync(R('data/forward/bt_ulang_ringkasan.json'), 'utf8'));
const cekBT = ['return_total', 'cagr', 'mdd'].every(k => Math.abs(btU.ekuitas[k] - bt.ekuitas[k]) < 1e-9) && btU.trade.jumlah === bt.trade.jumlah;
// ---- 2) backtest di jendela forward: candle keputusan pertama & terakhir yang diproses bot sesudah freeze
const F = fw.jendela.mulai, E = fw.jendela.akhir, proc = state.log.calls.filter(c => c.hasil === 'DIPROSES' && c.t_mulai >= F && c.t_mulai <= E && c.candle).map(c => c.candle).sort();
let gap = null;
if (proc.length) {
  const a = proc[0], b = proc.at(-1), pfx = 'data/forward/bt_jendela_';
  execFileSync(node, [FP('tools/backtest.mjs'), a, b, '--sinyal', FP(pfx + 'sinyal.csv'), '--trades', FP(pfx + 'trades.csv'), '--ekuitas', FP(pfx + 'ekuitas.csv')], { stdio: 'ignore' });
  const csv = f => { const [h, ...L] = fs.readFileSync(R(f), 'utf8').trim().split('\n'); const K = h.split(','); return L.filter(Boolean).map(l => Object.fromEntries(l.split(',').map((v, i) => [K[i], v]))); };
  const bS = csv(pfx + 'sinyal.csv').map(s => ({ candle: s.candle_t, pair: s.pair, sisi: s.sisi, alasan: s.alasan })), bT = csv(pfx + 'trades.csv'), bE = csv(pfx + 'ekuitas.csv').map(x => ({ t: x.t, eq: +x.ekuitas }));
  const sig = cocokkanSinyal(fw.sinyal.filter(s => s.candle >= a && s.candle <= b), bS);
  const next = c => new Date(Date.parse(c + ':00Z') + TF_MS).toISOString().slice(0, 16);   // bar eksekusi backtest = candle keputusan + 4 jam
  const fill = state.log.orders.filter(o => o.t >= F && o.t <= E).map(o => { const ex = next(o.candle), t = bT.find(x => x.pair === o.pair && (o.sisi === 'BELI' ? x.masuk === ex : x.keluar === ex));
    const px = t ? +(o.sisi === 'BELI' ? t.harga_masuk : t.harga_keluar) : null; return { candle: o.candle, pair: o.pair, sisi: o.sisi, bot: o.harga_fill, backtest: px, selisih: px ? o.harga_fill / px - 1 : null, telat_menit: Math.round((Date.parse(o.t) - Date.parse(ex + ':00Z')) / 60000) }; });
  gap = { jendela_candle: [a, b], sinyal: sig, bt_jendela: equityStats(bE), fill };
}
const out = { dibuat: new Date().toISOString(), sumber_log: state.sumber, diekspor: state.diekspor, backtest: bt, backtest_ulang_sama: cekBT, forward: fw, gap };
fs.writeFileSync(R('data/hasil_hitung_ulang.json'), JSON.stringify(out, null, 1)); fs.writeFileSync(R('public/hasil_hitung_ulang.json'), JSON.stringify({ gap }, null, 1));
// ---- 3) dashboard offline mandiri: kode tampilan & data disematkan (tanpa internet)
const mod = s => s.replace(/^export /gm, '').replace(/^import .*$/gm, '');
const html = `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bot Dry Run Indodax (offline)</title><style>${mod(fs.readFileSync(R('public/render.js'), 'utf8')).match(/CSS = `([\s\S]*?)`;/)[1]}</style></head>
<body><header><div class="hwrap"><div class="brand"><div class="logo"><svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true"><circle cx="9" cy="10" r="6" fill="#9A7158"/><circle cx="31" cy="10" r="6" fill="#9A7158"/><circle cx="9" cy="10" r="3" fill="#F4B9C6"/><circle cx="31" cy="10" r="3" fill="#F4B9C6"/><circle cx="20" cy="22" r="14" fill="#9A7158"/><ellipse cx="20" cy="27" rx="7" ry="5.5" fill="#F6E6D3"/><circle cx="15" cy="20" r="1.8" fill="#4A2C1D"/><circle cx="25" cy="20" r="1.8" fill="#4A2C1D"/><ellipse cx="20" cy="25" rx="2.2" ry="1.6" fill="#4A2C1D"/><circle cx="11" cy="25" r="2.2" fill="#F4B9C6" opacity=".8"/><circle cx="29" cy="25" r="2.2" fill="#F4B9C6" opacity=".8"/><path d="M17.5 28.5q2.5 2 5 0" stroke="#4A2C1D" stroke-width="1.3" fill="none" stroke-linecap="round"/><path d="M15 6.5l5 2.5 5-2.5v5l-5-2.5-5 2.5z" fill="#E58DA2"/><circle cx="20" cy="9" r="1.6" fill="#D9738C"/></svg></div><div><h1>Dysa <span>♡</span> Trading System</h1><small>Bot dry run Indodax · Breakout Hybrid 4 jam · Maudy Anisa Putri · 25110200026</small></div></div></div></header><main><p class="m">Dibuat ${out.dibuat} oleh tools/hitung_ulang.mjs dari log yang diekspor ${state.diekspor}. Backtest dijalankan ulang: ${cekBT ? 'hasil SAMA dengan ringkasan backtest' : 'BERBEDA dengan ringkasan backtest — periksa'}.</p><div id="o"></div></main>
<script>${mod(fs.readFileSync(R('public/render.js'), 'utf8'))}
const DATA = ${JSON.stringify({ bt, fw, gap, sumber: state.sumber + '/api/state (ekspor ' + state.diekspor + ')' })};
renderDashboard(document.getElementById('o'), DATA);</script></body></html>`;
fs.writeFileSync(R('dashboard_offline.html'), html);
const p = x => x == null ? '–' : (x * 100).toFixed(2) + '%';
console.log(`backtest ulang sama: ${cekBT} · forward: return ${p(fw.ekuitas.return_total)} · MDD ${p(fw.ekuitas.mdd)} · trade ${fw.trade.jumlah} · uptime ${p(fw.operasional.uptime)} (${fw.operasional.candle_tepat_waktu}/${fw.operasional.candle_terjadwal}) · error API ${fw.operasional.error_api} · kill ${fw.operasional.kill_switch}`);
if (gap) console.log(`jendela ${gap.jendela_candle.join(' → ')} · sinyal bot ${gap.sinyal.bot} · backtest ${gap.sinyal.backtest} · identik ${gap.sinyal.identik} (${p(gap.sinyal.kecocokan)}) · return backtest jendela ${p(gap.bt_jendela.return_total)}`);
console.log('→ data/hasil_hitung_ulang.json · public/hasil_hitung_ulang.json · dashboard_offline.html');
