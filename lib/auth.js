// Otorisasi /api/tick: (1) header Authorization: Bearer CRON_SECRET (Vercel Cron / manual), atau
// (2) tanda tangan QStash (header Upstash-Signature = JWT HS256 dengan QSTASH_CURRENT_SIGNING_KEY / QSTASH_NEXT_SIGNING_KEY; iss "Upstash", belum kedaluwarsa,
//     hash body cocok; padding '=' diabaikan seperti SDK resmi). Tidak ada secret di repo.
import crypto from 'crypto';
const unpad = s => String(s || '').replace(/=+$/, '');
const b64u = b => unpad(Buffer.from(b).toString('base64')).replace(/\+/g, '-').replace(/\//g, '_');
export function qstashCheck(sig, body = '') {
  if (!sig) return 'tanpa header Upstash-Signature';
  const [h, p, s] = sig.split('.'); if (!h || !p || !s) return 'format JWT salah';
  const keys = [process.env.QSTASH_CURRENT_SIGNING_KEY, process.env.QSTASH_NEXT_SIGNING_KEY].filter(Boolean);
  if (!keys.length) return 'signing key tidak ada di env';
  if (!keys.some(k => { const x = b64u(crypto.createHmac('sha256', k).update(h + '.' + p).digest()); return x.length === unpad(s).length && crypto.timingSafeEqual(Buffer.from(x), Buffer.from(unpad(s))); })) return 'tanda tangan tidak cocok';
  let c; try { c = JSON.parse(Buffer.from(p, 'base64url').toString()); } catch { return 'payload JWT rusak'; }
  const now = Date.now() / 1000;
  if (c.iss !== 'Upstash') return 'iss bukan Upstash';
  if (c.exp && now > c.exp + 30) return 'kedaluwarsa';
  if (c.nbf && now < c.nbf - 30) return 'belum berlaku';
  if (c.body != null && unpad(c.body) !== b64u(crypto.createHash('sha256').update(body).digest())) return 'hash body tidak cocok';
  return null;
}
export function authorized(req) {
  const a = req.headers.authorization || '';
  if (process.env.CRON_SECRET && a === 'Bearer ' + process.env.CRON_SECRET) return 'secret';
  if (!qstashCheck(req.headers['upstash-signature'])) return 'qstash';
  return null;
}
