// Pengumpul snapshot order book Indodax di laptop (persiapan UAS) · tiap jam di menit ke-3, 8 pasangan, berurutan (jeda 400 ms, < 3 request/detik)
// Simpan mentah: data/snapshots/YYYY-MM-DD.jsonl  (satu baris = satu pasangan pada satu waktu; 20 level bid & ask)
// node tools/snapshot_loop.mjs            (berjalan terus)   ·   node tools/snapshot_loop.mjs once   (sekali)
import fs from 'fs';
const PAIRS = ['btcidr', 'ethidr', 'xrpidr', 'dogeidr', 'trxidr', 'veloidr', 'adaidr', 'bnbidr'];
const OUT = new URL('../data/snapshots/', import.meta.url), sleep = ms => new Promise(r => setTimeout(r, ms));
async function getJSON(url, tries = 3) { for (let i = 1; i <= tries; i++) { try { const r = await fetch(url, { signal: AbortSignal.timeout(10000) }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); } catch (e) { if (i === tries) throw e; await sleep(1000 * i); } } }
async function once() {
  let st = null; try { st = (await getJSON('https://indodax.com/api/server_time')).server_time; } catch {}
  for (const p of PAIRS) { const t = Date.now(); let row;
    try { const d = await getJSON(`https://indodax.com/api/depth/${p}`); row = { t_local: t, server_time: st, pair: p, bids: (d.buy || []).slice(0, 20), asks: (d.sell || []).slice(0, 20) }; }
    catch (e) { row = { t_local: t, server_time: st, pair: p, error: String(e.message || e) }; }
    fs.appendFileSync(new URL(new Date(t).toISOString().slice(0, 10) + '.jsonl', OUT), JSON.stringify(row) + '\n'); await sleep(400); }
  console.log(new Date().toISOString(), 'snapshot', PAIRS.length, 'pasangan');
}
if (process.argv[2] === 'once') await once();
else for (;;) { await once(); const n = new Date(), next = new Date(n); next.setUTCMinutes(3, 0, 0); if (next <= n) next.setUTCHours(next.getUTCHours() + 1); await sleep(next - n); }
