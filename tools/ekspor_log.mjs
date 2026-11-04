// Ekspor SEMUA log mentah bot dari Vercel (/api/state?log=all) → data/forward/state.json + satu CSV per log (untuk dikumpulkan)
// node tools/ekspor_log.mjs [https://uas-maudy-bot.vercel.app]
import fs from 'fs';
const BASE = process.argv[2] || 'https://uas-maudy-bot.vercel.app', OUT = new URL('../data/forward/', import.meta.url);
fs.mkdirSync(OUT, { recursive: true });
const r = await fetch(BASE + '/api/state?log=all', { signal: AbortSignal.timeout(120000) }); if (!r.ok) throw new Error('HTTP ' + r.status);
const j = await r.json(); j.diekspor = new Date().toISOString(); j.sumber = BASE;
fs.writeFileSync(new URL('state.json', OUT), JSON.stringify(j));
const csv = rows => { const K = [...new Set(rows.flatMap(x => Object.keys(x)))], q = v => v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return K.join(',') + '\n' + rows.map(x => K.map(k => { const s = q(x[k]); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\n') + '\n'; };
for (const [k, rows] of Object.entries(j.log)) fs.writeFileSync(new URL(`log_${k}.csv`, OUT), csv(rows));
console.log('diekspor', Object.fromEntries(Object.entries(j.log).map(([k, v]) => [k, v.length])), '→ data/forward/');
