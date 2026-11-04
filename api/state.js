// /api/state — data publik untuk dashboard (state + semua log mentah). Tidak memuat secret. ?log=calls,orders (opsional, default semua kecuali snapshots; ?log=all = semua) · ?snap=BTCIDR
import { getJSON, readLog, LOGS } from '../lib/store.js';
import { PARAMS } from '../lib/strategy.js';
import { COSTS } from '../lib/costs.js';
import { PAIRS } from '../lib/indodax.js';
export default async function handler(req, res) {
  try {
    const want = (req.query?.log === 'all' ? LOGS : req.query?.log ? String(req.query.log).split(',') : LOGS.filter(l => l !== 'snapshots')).filter(l => LOGS.includes(l)), out = { state: await getJSON('state'), params: PARAMS, costs: COSTS, pairs: PAIRS, freeze: process.env.FREEZE_AT || '2026-11-04T05:00:00Z', log: {} };
    for (const l of want) out.log[l] = await readLog(l);
    if (req.query?.snap && !want.includes('snapshots')) { const P = String(req.query.snap).split(','); out.log.snapshots = (await readLog('snapshots')).filter(x => P.includes(x.pair)); }   // ?snap=BTCIDR: snapshot satu pasangan saja (dashboard)
    res.setHeader('cache-control', 'no-store'); return res.status(200).json(out);
  } catch (e) { return res.status(500).json({ error: String(e.message || e) }); }
}
