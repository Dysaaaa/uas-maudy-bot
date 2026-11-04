// /api/tick — satu panggilan bot dry run: baca state → ambil candle tertutup & order book → validasi → decide() (fungsi yang sama dengan backtest)
// → eksekusi simulasi di bid/ask (menghabiskan level order book) → simpan state & log. Dilindungi CRON_SECRET / tanda tangan QStash. Tanpa API key Indodax.
import { PARAMS, decide, execMonth } from '../lib/strategy.js';
import { COSTS } from '../lib/costs.js';
import { PAIRS, serverTime, closedCandles, orderBook, validateBars, validateBook, cutWindow, walkBuy, walkSell } from '../lib/indodax.js';
import { authorized, qstashCheck } from '../lib/auth.js';
import { getJSON as rget, setJSON, cmd, pipeline, logCmd, key } from '../lib/store.js';

const FREEZE = process.env.FREEZE_AT || '2026-11-04T05:00:00Z', MODAL = 100e6;
const wibDay = ms => new Date(ms + 7 * 3600e3).toISOString().slice(0, 10);   // hari WIB berganti 00.00 WIB = 17.00 UTC

export default async function handler(req, res) {
  const t0 = Date.now(), q = req.query || {};
  const via = authorized(req);
  if (!via) { if (req.headers['upstash-signature']) { try { await pipeline([logCmd('errors', { t: new Date().toISOString(), tahap: 'otorisasi', error: 'QStash ditolak: ' + qstashCheck(req.headers['upstash-signature']) })]); } catch {} }   // alasan saja, tanpa isi token
    return res.status(401).json({ error: 'unauthorized' }); }
  const sumber = (q.sumber || (req.headers['user-agent'] || '').slice(0, 40)) + ' [' + via + ']', errors = [], logs = [], call = { t_mulai: new Date(t0).toISOString(), sumber, hasil: null };
  // kunci agar dua panggilan bersamaan tidak berjalan paralel (idempotency lapis 1)
  const lock = await cmd('SET', key('lock'), String(t0), 'NX', 'EX', 240);
  if (lock !== 'OK') { call.hasil = 'DILEWATI_ADA_PANGGILAN_LAIN'; await pipeline([logCmd('calls', call)]); return res.status(200).json(call); }
  try {
    const st = await rget('state', { cash: MODAL, positions: [], exM: {}, pend: {}, lastCandle: null, dayKey: null, dayStart: MODAL, started: new Date(t0).toISOString() });
    const srv = await serverTime(errors); call.server_time = new Date(srv).toISOString();
    // forward test dimulai DATAR di freeze: state masa persiapan direset sekali (dicatat), agar sama dengan backtest jendela forward yang mulai tanpa posisi
    if (st.started < FREEZE && new Date(srv).toISOString() >= FREEZE) { logs.push(logCmd('notes', { t: new Date(srv).toISOString(), catatan: 'RESET_STATE_FREEZE', state_lama: st }));
      Object.assign(st, { cash: MODAL, positions: [], exM: {}, pend: {}, lastCandle: null, dayKey: null, dayStart: MODAL, started: new Date(srv).toISOString() }); }
    // ---- data: candle tertutup tiap pasangan (berurutan, bukan paralel) + order book
    const bars = {}, books = {};
    for (const p of PAIRS) {
      try { bars[p] = await closedCandles(p, PARAMS.tf, PARAMS.window, srv, errors); } catch (e) { bars[p] = []; errors.push({ pair: p, tahap: 'candle', error: String(e.message || e) }); }
      try { books[p] = await orderBook(p, errors); } catch (e) { books[p] = null; errors.push({ pair: p, tahap: 'depth', error: String(e.message || e) }); }
      if (books[p]) logs.push(logCmd('snapshots', { t: new Date().toISOString(), pair: p, bids: books[p].bids.slice(0, 20), asks: books[p].asks.slice(0, 20) }));
    }
    // ---- candle keputusan = candle tertutup terakhir BTC; idempotency lapis 2: tiap candle hanya diproses sekali
    const candle = bars.BTCIDR?.at(-1)?.t || null; call.candle = candle;
    const bid = p => books[p]?.bids?.[0]?.[0], value = () => st.positions.reduce((s, x) => s + x.qty * (bid(x.pair) ?? x.lastBid ?? x.entryPrice), 0);
    for (const x of st.positions) if (bid(x.pair)) x.lastBid = bid(x.pair);
    const eqNow = st.cash + value(), dk = wibDay(srv);
    if (dk !== st.dayKey) { st.dayKey = dk; st.dayStart = eqNow; logs.push(logCmd('equity', { hari_wib: dk, t: new Date(srv).toISOString(), ekuitas: eqNow, kas: st.cash, posisi: st.positions.length })); }
    call.ekuitas = eqNow;
    if (!candle || (st.lastCandle && candle <= st.lastCandle)) { call.hasil = candle ? 'CANDLE_SUDAH_DIPROSES' : 'TIDAK_ADA_CANDLE'; }
    else {
      const kill = (await cmd('GET', key('kill'))) === '1' || process.env.KILL_SWITCH === '1', lossHit = eqNow <= st.dayStart * (1 - PARAMS.dailyLoss);
      if (kill) logs.push(logCmd('kill', { t: new Date().toISOString(), candle, aktif: true, sumber: process.env.KILL_SWITCH === '1' ? 'env' : 'redis' }));
      const forward = new Date(srv).toISOString() >= FREEZE;
      // pasangan yang candle terakhirnya tidak sama dengan BTC tidak ikut keputusan (sama dengan backtest: hanya pasangan yang punya bar di waktu itu)
      const win = {}, invalid = {};
      for (const p of PAIRS) { if (!bars[p].length || bars[p].at(-1).t !== candle) continue; win[p] = cutWindow(bars[p], candle, PARAMS.window, PARAMS.tf);
        const why = [...validateBars(win[p], PARAMS.tf, srv, PARAMS.warmup), ...validateBook(books[p])]; if (why.length) invalid[p] = why; }
      const d = decide(win, st.positions.map(x => ({ pair: x.pair, entryPrice: x.entryPrice })), { blocked: kill || lossHit, noEntry: new Set(Object.keys(invalid)), memo: { exM: st.exM, pend: st.pend } });
      call.info = d.info; call.blokir = { kill, dailyLoss: lossHit };
      for (const x of d.exits) logs.push(logCmd('signals', { candle, pair: x.pair, sisi: 'JUAL', alasan: x.reason, harga_sinyal: x.signalPrice }));
      for (const x of d.entries) logs.push(logCmd('signals', { candle, pair: x.pair, sisi: 'BELI', alasan: x.reason, harga_sinyal: x.signalPrice, valid: true }));
      for (const x of d.rejected) logs.push(logCmd('signals', { candle, pair: x.pair, sisi: 'BELI', alasan: x.reason, harga_sinyal: x.signalPrice, valid: false, alasan_tidak_valid: invalid[x.pair] }));
      // ---- exit dulu (jual di bid)
      for (const x of d.exits) { const p = st.positions.find(z => z.pair === x.pair), b = books[x.pair]; if (!p) continue;
        if (!b?.bids?.length) { errors.push({ pair: x.pair, tahap: 'jual', error: 'order book kosong, jual ditunda' }); continue; }
        const f = walkSell(b.bids, p.qty), fee = f.gross * COSTS.feeSell;
        st.cash += f.gross - fee; st.positions = st.positions.filter(z => z !== p); st.exM[x.pair] = execMonth(candle); st.pend[x.pair] = 1;
        logs.push(logCmd('orders', { t: new Date().toISOString(), candle, pair: x.pair, sisi: 'JUAL', qty: f.qty, best_bid: b.bids[0][0], best_ask: b.asks[0]?.[0], harga_fill: f.avg, nilai: f.gross, fee, harga_sinyal: x.signalPrice, selisih_vs_sinyal: f.avg / x.signalPrice - 1, alasan: x.reason, lengkap: f.complete,
          masuk: p.t, harga_masuk: p.entryPrice, biaya_masuk: p.cost, pnl: f.gross - fee - p.cost, forward })); }
      // ---- entry (beli di ask) — decide() sudah melewati pasangan yang datanya tidak valid
      const eq0 = st.cash + value();
      for (const x of d.entries) { const b = books[x.pair];
        const idr = Math.min(x.weight * eq0, PARAMS.maxPosValue * eq0, st.cash / (1 + COSTS.feeBuy)); if (idr < COSTS.minOrderIDR) { logs.push(logCmd('notes', { candle, pair: x.pair, catatan: 'kas < minimum order' })); continue; }
        if (st.positions.some(z => z.pair === x.pair)) continue;
        const f = walkBuy(b.asks, idr), fee = f.filled_idr * COSTS.feeBuy; if (!(f.qty > 0)) continue;
        st.cash -= f.filled_idr + fee;
        delete st.pend[x.pair]; st.positions.push({ pair: x.pair, t: candle, entryPrice: f.avg, qty: f.qty, cost: f.filled_idr + fee, lastBid: b.bids[0][0] });
        logs.push(logCmd('orders', { t: new Date().toISOString(), candle, pair: x.pair, sisi: 'BELI', qty: f.qty, best_bid: b.bids[0][0], best_ask: b.asks[0][0], harga_fill: f.avg, nilai: f.filled_idr, fee, harga_sinyal: x.signalPrice, selisih_vs_sinyal: f.avg / x.signalPrice - 1, alasan: x.reason, lengkap: f.complete, forward })); }
      // pasangan yang tidak valid dicatat tiap candle (alasan), termasuk yang tidak sejajar dengan candle BTC
      for (const p of PAIRS) if (!win[p]) invalid[p] = ['candle terakhir ' + (bars[p].at(-1)?.t || '–') + ' ≠ candle keputusan ' + candle];
      if (Object.keys(invalid).length) logs.push(logCmd('notes', { candle, catatan: 'DATA_TIDAK_VALID_UNTUK_ENTRY', pasangan: invalid }));
      st.lastCandle = candle; call.hasil = 'DIPROSES'; call.sinyal = { beli: d.entries.length, jual: d.exits.length }; call.tidak_valid = invalid;
    }
    call.ekuitas_akhir = st.cash + value(); call.posisi = st.positions.map(p => p.pair);
    await setJSON('state', st);
  } catch (e) { call.hasil = 'ERROR'; errors.push({ tahap: 'utama', error: String(e.stack || e) }); }
  finally {
    call.durasi_ms = Date.now() - t0; call.jumlah_error = errors.length;
    try { await pipeline([...logs, ...errors.map(e => logCmd('errors', { t: new Date().toISOString(), candle: call.candle, ...e })), logCmd('calls', call), ['DEL', key('lock')]]); } catch (e) { call.gagal_simpan_log = String(e.message || e); }
  }
  return res.status(200).json(call);
}
