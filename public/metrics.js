// METRIK BERSAMA — satu kode untuk dashboard Vercel (browser), tools/hitung_ulang.mjs (Node), dan ringkasan backtest.
// Semua angka dashboard dihitung dari log mentah lewat fungsi di file ini; tidak ada angka yang ditulis manual.
// Definisi:
//  • trade = satu posisi dari beli sampai jual (per pasangan); pnl = nilai jual − fee jual − (nilai beli + fee beli)
//  • biaya per trade = fee beli + fee jual + spread & slippage (beli: qty × (harga fill − mid); jual: qty × (mid − harga fill)), mid = (best bid + best ask)/2
//  • porsi biaya = Σ biaya ÷ laba kotor, laba kotor = Σ (pnl + biaya) = hasil sebelum biaya
//  • MDD dari kurva ekuitas (posisi dinilai di best bid); return total = ekuitas akhir ÷ modal − 1

export const MODAL = 100e6, TF_MS = 4 * 3600e3;   // candle 4 jam

export function tradeStats(trades) {
  const W = trades.filter(t => t.pnl > 0), L = trades.filter(t => t.pnl <= 0), sum = (a, f) => a.reduce((s, x) => s + f(x), 0), avg = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  const gw = sum(W, t => t.pnl), gl = -sum(L, t => t.pnl), biaya = sum(trades, t => t.biaya || 0), kotor = sum(trades, t => t.pnl + (t.biaya || 0));
  return { jumlah: trades.length, win_rate: trades.length ? W.length / trades.length : null, profit_factor: gl > 0 ? gw / gl : (gw > 0 ? Infinity : null),
    rata_untung: avg(W.map(t => t.ret)), rata_rugi: avg(L.map(t => t.ret)), laba_bersih: sum(trades, t => t.pnl), biaya_total: biaya, laba_kotor: kotor, porsi_biaya: kotor > 0 ? biaya / kotor : null };
}

export function equityStats(curve, { cagr = false } = {}) {
  if (!curve.length) return { return_total: null, mdd: null };
  let pk = curve[0].eq, mdd = 0; for (const x of curve) { pk = Math.max(pk, x.eq); mdd = Math.max(mdd, 1 - x.eq / pk); }
  const out = { awal: curve[0].eq, akhir: curve.at(-1).eq, return_total: curve.at(-1).eq / MODAL - 1, mdd };
  if (cagr) { const y = (Date.parse(curve.at(-1).t) - Date.parse(curve[0].t)) / 864e5 / 365.25; out.tahun = y; out.cagr = y > 0 ? (curve.at(-1).eq / curve[0].eq) ** (1 / y) - 1 : null; }
  return out;
}

const iso = s => (s.length === 16 ? s + ':00Z' : s);   // candle 'YYYY-MM-DDTHH:MM' (UTC) → ISO

// ---- forward test dari log bot (respons /api/state) · freeze & akhir ISO UTC
export function forwardFromLogs(state, { freeze, akhir } = {}) {
  const L = state.log, F = freeze || state.freeze, END = akhir || new Date(Date.parse(F) + 10 * 864e5).toISOString();
  const inF = t => t >= F && t <= END, calls = (L.calls || []).filter(c => inF(c.t_mulai)), orders = (L.orders || []).filter(o => inF(o.t));
  const mid = o => (o.best_bid + o.best_ask) / 2, buys = new Map(), trades = [];
  for (const o of orders) { const k = o.pair;
    if (o.sisi === 'BELI') buys.set(k, o);
    else { const b = buys.get(k); const spB = b ? b.qty * (b.harga_fill - mid(b)) : 0, spS = o.qty * (mid(o) - o.harga_fill);
      trades.push({ pair: o.pair, masuk: o.masuk, keluar: o.candle, pnl: o.pnl, ret: (o.nilai - o.fee) / o.biaya_masuk - 1, biaya: (b ? b.fee : 0) + o.fee + spB + spS, alasan: o.alasan, punya_beli_forward: !!b }); buys.delete(k); } }
  const curve = calls.filter(c => c.ekuitas_akhir != null).map(c => ({ t: c.t_mulai, eq: c.ekuitas_akhir }));
  // uptime: candle 4 jam yang TUTUP di dalam jendela; terlaksana bila ada panggilan DIPROSES untuk candle itu sebelum candle berikutnya tutup
  const first = Math.ceil(Date.parse(F) / TF_MS) * TF_MS, last = Math.min(Date.parse(END), Date.now()), cand = [];
  for (let c = first; c <= last; c += TF_MS) cand.push(new Date(c - TF_MS).toISOString().slice(0, 16));   // label = waktu buka candle
  const done = new Map(); for (const c of (L.calls || [])) if (c.hasil === 'DIPROSES' && c.candle) done.set(c.candle, c.t_mulai);
  const onTime = cand.filter(k => { const t = done.get(k); return t && Date.parse(t) < Date.parse(iso(k)) + 2 * TF_MS; });
  // beli & tahan BTC/IDR: beli di best ask snapshot pertama, nilai di best bid snapshot terakhir dalam jendela
  const snaps = (L.snapshots || []).filter(s => s.pair === 'BTCIDR' && inF(s.t) && s.bids?.length && s.asks?.length);
  const bh = snaps.length > 1 ? snaps.at(-1).bids[0][0] / snaps[0].asks[0][0] - 1 : null;
  return { jendela: { mulai: F, akhir: END }, ekuitas: equityStats(curve), trade: tradeStats(trades), trades, beli_tahan_btc: bh,
    operasional: { candle_terjadwal: cand.length, candle_tepat_waktu: onTime.length, uptime: cand.length ? onTime.length / cand.length : null, candle_terlewat: cand.filter(k => !onTime.includes(k)),
      panggilan: calls.length, panggilan_error: calls.filter(c => c.hasil === 'ERROR').length, error_api: (L.errors || []).filter(e => inF(e.t)).length, kill_switch: (L.kill || []).filter(k => inF(k.t)).length },
    sinyal: (L.signals || []).filter(s => s.candle && calls.some(c => c.hasil === 'DIPROSES' && c.candle === s.candle)) };   // sinyal = candle yang diproses bot di dalam jendela (candle yang dibuka sebelum freeze tetapi diproses sesudahnya ikut, sama dengan backtest jendela)
}

// ---- pencocokan sinyal bot vs backtest candle demi candle (kunci = candle|pair|sisi|alasan)
export function cocokkanSinyal(botSig, btSig) {
  const k = s => [s.candle, s.pair, s.sisi, s.alasan].join('|'), A = new Set(botSig.map(k)), B = new Set(btSig.map(k));
  const sama = [...A].filter(x => B.has(x)), hanyaBot = [...A].filter(x => !B.has(x)), hanyaBT = [...B].filter(x => !A.has(x));
  return { bot: A.size, backtest: B.size, identik: sama.length, hanya_bot: hanyaBot, hanya_backtest: hanyaBT, kecocokan: A.size + B.size === 0 ? 1 : sama.length / (A.size + B.size - sama.length) };
}

// ---- status bot terkini dari log mentah (semua panggilan sejak deploy, termasuk sebelum freeze)
export function botStatus(state, now = Date.now()) {
  const C = state.log.calls || [], last = C.at(-1), done = C.filter(c => c.hasil === 'DIPROSES' && c.candle).at(-1), F = Date.parse(state.freeze), END = F + 10 * 864e5;
  return { fase: now < F ? 'sebelum_freeze' : now <= END ? 'forward' : 'selesai', freeze: state.freeze, akhir: new Date(END).toISOString(), panggilan_total: C.length,
    panggilan_error: C.filter(c => c.hasil === 'ERROR').length, terakhir: last ? { t: last.t_mulai, sumber: last.sumber, hasil: last.hasil, error: last.jumlah_error, candle: last.candle } : null,
    candle_terakhir_diproses: done ? done.candle : null, ekuitas: last?.ekuitas_akhir ?? null, kas: state.state?.cash ?? null, posisi: (state.state?.positions || []).map(p => p.pair) };
}

// ---- uji coba sebelum freeze: rumus yang SAMA dengan forward test, jendela = panggilan terjadwal pertama → min(freeze, sekarang)
export function latihanFromLogs(state) {
  const first = (state.log.calls || []).find(c => /^(qstash|github-actions|vercel-cron) /.test(c.sumber || ''));
  if (!first) return null;
  const r = forwardFromLogs(state, { freeze: first.t_mulai, akhir: state.freeze });
  r.error_terakhir = (state.log.errors || []).filter(e => e.t >= first.t_mulai && e.t < state.freeze).slice(-5);
  return r;
}
