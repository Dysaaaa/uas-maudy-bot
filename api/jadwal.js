// /api/jadwal — membuat/memeriksa jadwal QStash tiap jam (menit ke-5) yang memanggil /api/tick. Token QStash dipakai di server saja (tidak pernah dikirim keluar).
// Dilindungi CRON_SECRET. GET = lihat jadwal · POST = buat jadwal bila belum ada (idempoten). Pemakaian dicatat di log 'notes'.
import { authorized } from '../lib/auth.js';
import { pipeline, logCmd } from '../lib/store.js';
const DEST = (process.env.PUBLIC_URL || 'https://uas-maudy-bot.vercel.app') + '/api/tick?sumber=qstash', CRON = '5 * * * *';
export default async function handler(req, res) {
  if (authorized(req) !== 'secret') return res.status(401).json({ error: 'unauthorized' });
  const Q = process.env.QSTASH_URL || 'https://qstash.upstash.io', H = { authorization: 'Bearer ' + process.env.QSTASH_TOKEN };
  const list = async () => { const r = await fetch(Q + '/v2/schedules', { headers: H }); const j = await r.json(); return Array.isArray(j) ? j.map(s => ({ id: s.scheduleId, cron: s.cron, tujuan: s.destination, metode: s.method, retries: s.retries, dibuat: s.createdAt })) : j; };
  let ada = await list(), dibuat = null;
  if (req.method === 'POST' && Array.isArray(ada) && !ada.some(s => s.tujuan === DEST && s.cron === CRON)) {
    const r = await fetch(Q + '/v2/schedules/' + DEST, { method: 'POST', headers: { ...H, 'Upstash-Cron': CRON, 'Upstash-Method': 'GET', 'Upstash-Retries': '2' } });
    dibuat = await r.json(); ada = await list();
    await pipeline([logCmd('notes', { t: new Date().toISOString(), catatan: 'JADWAL_QSTASH_DIBUAT', cron: CRON, tujuan: DEST, hasil: dibuat })]);
  }
  // ?uji=1 (POST): kirim SATU pesan QStash sekarang ke /api/tick (uji tanda tangan tanpa menunggu jadwal)
  let uji = null; if (req.method === 'POST' && req.query?.uji === '1') { const r = await fetch(Q + '/v2/publish/' + DEST.replace('sumber=qstash', 'sumber=qstash-uji'), { method: 'POST', headers: { ...H, 'Upstash-Method': 'GET', 'Upstash-Retries': '0' } }); uji = await r.json(); }
  // log pengiriman QStash terakhir (status HTTP dari /api/tick) untuk diagnosis
  let log = null; try { const r = await fetch(Q + '/v2/logs?count=12', { headers: H }); const j = await r.json(); log = (j.logs || j.events || j).slice?.(0, 12).map(e => ({ waktu: new Date(e.time).toISOString(), status: e.state, http: e.responseStatus, respon: String(e.responseBody || e.error || '').slice(0, 160), url: e.url })) ?? j; } catch (e) { log = String(e.message || e); }
  return res.status(200).json({ dibuat, uji, jadwal: ada, log });
}
