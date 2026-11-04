// Akses API publik Indodax (tanpa API key) + validasi data + simulasi fill di order book. Dipakai bot (api/tick.js).
export const PAIRS = ['BTCIDR', 'ETHIDR', 'XRPIDR', 'DOGEIDR', 'TRXIDR', 'VELOIDR', 'ADAIDR', 'BNBIDR'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

// GET JSON dengan timeout & retry terbatas (3 kali, jeda 1 s / 2 s); error terakhir dilempar ke pemanggil
export async function getJSON(url, { tries = 3, timeout = 10000, errors = null } = {}) {
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(timeout), headers: { 'user-agent': 'uas-dry-run-bot-maudy' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (j == null || (Array.isArray(j) && !j.length) || (typeof j === 'object' && !Array.isArray(j) && !Object.keys(j).length)) throw new Error('respons kosong');
      return j;
    } catch (e) {
      errors?.push({ url, percobaan: i, error: String(e.message || e) });
      if (i === tries) throw e;
      await sleep(1000 * i);
    }
  }
}

export const serverTime = async errors => (await getJSON('https://indodax.com/api/server_time', { errors })).server_time;   // ms

// candle TERTUTUP: buang bar dengan Time + durasi > server_time
export async function closedCandles(sym, tfMin, n, serverMs, errors) {
  const to = Math.floor(serverMs / 1000), from = to - (n + 3) * tfMin * 60;
  const raw = await getJSON(`https://indodax.com/tradingview/history_v2?symbol=${sym}&tf=${tfMin}&from=${from}&to=${to}`, { errors });
  return raw.filter(b => (b.Time + tfMin * 60) * 1000 <= serverMs).sort((a, b) => a.Time - b.Time)
    .map(b => ({ t: new Date(b.Time * 1000).toISOString().slice(0, 16), o: +b.Open, h: +b.High, l: +b.Low, c: +b.Close, v: +b.Volume }));
}

// validasi candle sebelum boleh MEMBUKA posisi pada satu pasangan → daftar alasan (kosong = valid). Dipakai bot DAN backtest (nowMs = waktu panggilan / tutup candle).
export function validateBars(bars, tfMin, nowMs, need) {
  const why = [], ms = tfMin * 60e3;
  if (!bars.length) return ['candle kosong'];
  const last = Date.parse(bars.at(-1).t + 'Z');
  if (nowMs - (last + ms) > 2 * ms) why.push('candle tertutup terakhir lebih tua dari 2× timeframe');
  const w = bars.slice(-need);
  if (w.length < need) why.push(`candle kurang dari ${need}`);
  for (let i = 1; i < w.length; i++) if (msOf(w[i]) - msOf(w[i - 1]) !== ms) { why.push('ada candle hilang di jendela indikator'); break; }
  if (w.some(b => !(b.o > 0 && b.h > 0 && b.l > 0 && b.c > 0))) why.push('harga nol di jendela indikator');
  if (!(bars.at(-1).v > 0)) why.push('volume candle terakhir nol');
  return why;
}
// validasi order book (bot: order book live; backtest: median spread terukur)
export function validateBook(book) {
  if (!book || !book.bids.length || !book.asks.length) return ['order book kosong'];
  const bid = book.bids[0][0], ask = book.asks[0][0]; return (ask - bid) / ((ask + bid) / 2) > MAX_SPREAD ? ['selisih bid–ask > 2%'] : [];
}
export const MAX_SPREAD = 0.02;
// potong jendela candle menurut WAKTU: hanya bar dengan waktu buka > candle keputusan − window jam (sama di bot & backtest)
export const cutWindow = (bars, lastT, windowBars, tfMin) => { const lo = Date.parse(lastT + 'Z') - windowBars * tfMin * 60e3; return bars.filter(b => msOf(b) > lo && b.t <= lastT); };
const msOf = b => b.ms ??= Date.parse(b.t + 'Z');   // waktu buka candle (ms), disimpan di bar agar tidak di-parse ulang

export async function orderBook(pair, errors) {
  const d = await getJSON(`https://indodax.com/api/depth/${pair.toLowerCase()}`, { errors });
  return { bids: (d.buy || []).map(([p, q]) => [+p, +q]), asks: (d.sell || []).map(([p, q]) => [+p, +q]) };
}

// beli senilai idr: habiskan level ask berurutan → { qty, avg, filled_idr } (qty dibulatkan ke bawah 1e-8)
export function walkBuy(asks, idr) {
  let left = idr, qty = 0, spent = 0;
  for (const [p, q] of asks) { const v = Math.min(left, p * q); qty += v / p; spent += v; left -= v; if (left <= 1e-6) break; }
  qty = Math.floor(qty * 1e8) / 1e8;
  return { qty, avg: qty > 0 ? spent / qty : NaN, filled_idr: spent, complete: left <= 1e-6 };
}
// jual qty: habiskan level bid berurutan → { qty, avg, gross }
export function walkSell(bids, qty) {
  let left = qty, got = 0, sold = 0;
  for (const [p, q] of bids) { const x = Math.min(left, q); got += x * p; sold += x; left -= x; if (left <= 1e-12) break; }
  return { qty: sold, avg: sold > 0 ? got / sold : NaN, gross: got, complete: left <= 1e-12 };
}
