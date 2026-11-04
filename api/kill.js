// /api/kill?aktif=1|0 — kill switch manual tanpa deploy ulang (flag di Redis). Dilindungi CRON_SECRET. Setiap pemakaian dicatat di log 'kill'.
import { authorized } from '../lib/auth.js';
import { cmd, pipeline, logCmd, key } from '../lib/store.js';
export default async function handler(req, res) {
  if (authorized(req) !== 'secret') return res.status(401).json({ error: 'unauthorized' });
  const on = String(req.query?.aktif ?? '1') === '1';
  await cmd('SET', key('kill'), on ? '1' : '0');
  await pipeline([logCmd('kill', { t: new Date().toISOString(), aksi: on ? 'NYALA' : 'MATI', sumber: 'api/kill' })]);
  return res.status(200).json({ kill: on });
}
