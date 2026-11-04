// STRATEGI DYSA (Breakout Hybrid + filter pasar, strategi UTS Kompas100 harian, diadaptasi ke kripto IDR Indodax) — SATU fungsi sinyal dipakai backtest DAN bot.
// Input hanya candle yang SUDAH TERTUTUP. Keputusan di close bar t, dieksekusi sesudahnya (bot: order book live; backtest: open bar t+1 ± biaya terukur).
// UTS: filter IHSG > SMA100 hari → di sini BTC/IDR > SMA100 hari. Entry: close > high tertinggi 55 hari sebelumnya & close > SMA100 hari.
// Exit: close ≤ harga beli × (1 − 8%), atau close < low terendah 20 hari sebelumnya. Panjang indikator ditulis dalam HARI × 6 bar (1 hari = 6 candle 4 jam).
// Timeframe dipilih SETELAH membandingkan backtest 1 jam / 4 jam / harian (in-sample, dicatat di README). Sesudah exit tidak boleh masuk lagi di bulan yang sama;
// saat masuk bulan baru boleh masuk lagi bila close > SMA100 (re-entry). Bulan = bulan UTC waktu buka bar.
import { PAIRS } from './indodax.js';

export const PARAMS = Object.freeze({
  tf: 240,                  // menit per candle
  N: 330, M: 120, T: 600,   // breakout 55 hari, breakdown 20 hari, filter tren SMA 100 hari (× 6 bar)
  sl: 0.08,                 // stop-loss 8% dari harga beli
  gateMA: 600,              // filter pasar: BTC/IDR close > SMA 100 hari (600 bar) → boleh beli baru
  S: 10, slot: 0.10,        // 10 slot, 10% ekuitas per posisi (sama dengan UTS)
  maxPosValue: 0.10,        // ukuran maksimum satu posisi (porsi ekuitas)
  dailyLoss: 0.05,          // daily loss limit: ekuitas ≤ 95% ekuitas awal hari WIB → tidak membuka posisi baru sampai 00.00 WIB berikutnya
  warmup: 601,              // bar minimal untuk menghitung sinyal
  window: 700,              // jendela waktu (dalam bar) candle tertutup terakhir yang diberikan ke decide() — dipotong menurut WAKTU, sama di bot & backtest
});

export const sma = (a, n, i) => { if (i < n - 1) return NaN; let s = 0; for (let k = i - n + 1; k <= i; k++) s += a[k]; return s / n; };
export const monthOf = ms => new Date(ms).toISOString().slice(0, 7);
// bulan bar eksekusi = bulan bar sesudah candle t; dipakai bot & backtest saat mencatat bulan exit
export const execMonth = t => monthOf(Date.parse(t + 'Z') + PARAMS.tf * 60e3);

// bars: { PAIR: [{t,o,h,l,c,v}, ...] } candle tertutup, urut waktu, bar terakhir = bar keputusan
// positions: [{pair, entryPrice}] ; blocked = daily loss limit / kill switch ; noEntry = Set pasangan yang datanya tidak valid untuk entry
// memo: { exM: {pair: 'YYYY-MM' bulan exit terakhir}, pend: {pair: 1 = sudah exit dan belum masuk lagi} }
// → { exits: [{pair, reason, signalPrice}], entries: [{pair, reason, signalPrice, weight}], rejected: [sinyal beli yang ditolak karena data tidak valid], info }
// Kandidat beli diurutkan dari yang terkuat (close ÷ high 55 hari atau close ÷ SMA100 hari), sama dengan UTS.
export function decide(bars, positions, { blocked = false, noEntry = new Set(), memo = { exM: {}, pend: {} } } = {}) {
  const P = PARAMS, out = { exits: [], entries: [], rejected: [], info: {} };
  const held = new Set(positions.map(p => p.pair));
  const btc = bars.BTCIDR, bi = btc ? btc.length - 1 : -1, bc = btc ? btc.map(x => x.c) : [], gate = !!btc && !(bc[bi] < sma(bc, P.gateMA, bi));
  out.info = { t: btc?.at(-1)?.t ?? null, btcDiAtasSMA100: gate };
  // ---- exit posisi terbuka (stop-loss diperiksa lebih dulu)
  for (const p of positions) { const b = bars[p.pair]; if (!b || b.length < P.warmup) continue; const i = b.length - 1, c = b[i].c;
    let lo = Infinity; for (let k = i - P.M; k < i; k++) lo = Math.min(lo, b[k].l);
    const r = c <= p.entryPrice * (1 - P.sl) ? 'STOP_8PCT' : c < lo ? 'BREAKDOWN_LOW20H' : null;
    if (r) out.exits.push({ pair: p.pair, reason: r, signalPrice: c }); }
  if (blocked || !gate) return out;   // daily loss / kill switch / BTC di bawah SMA100: tidak ada beli baru
  // ---- entry
  const cand = [];
  for (const pair of PAIRS) { const b = bars[pair]; if (!b || held.has(pair) || b.length < P.warmup) continue; const c = b.map(x => x.c), i = c.length - 1;
    const mNow = b[i].t.slice(0, 7), mNext = execMonth(b[i].t); if (mNext === memo.exM[pair]) continue;   // sudah exit di bulan ini → tunggu bulan baru
    const T = sma(c, P.T, i); if (!(c[i] > T)) continue;
    let H = -Infinity; for (let k = i - P.N; k < i; k++) H = Math.max(H, b[k].h);
    let x = null;
    if (c[i] > H) x = { pair, reason: 'BREAKOUT_HIGH55H', signalPrice: c[i], weight: Math.min(P.slot, P.maxPosValue), sc: c[i] / H - 1 };
    else if (memo.pend[pair] && mNext !== mNow) x = { pair, reason: 'RE_ENTRY_BULAN_BARU', signalPrice: c[i], weight: Math.min(P.slot, P.maxPosValue), sc: c[i] / T - 1 };
    if (!x) continue;
    if (noEntry.has(pair)) out.rejected.push({ ...x, reason: x.reason + '_DATA_TIDAK_VALID' }); else cand.push(x); }
  cand.sort((a, b) => b.sc - a.sc);
  out.entries.push(...cand.slice(0, Math.max(0, P.S - (held.size - out.exits.length))));
  out.info.kandidat = cand.map(x => x.pair);
  return out;
}
