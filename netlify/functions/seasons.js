// Season history: keeps one small record per season (calendar year) for each public profile id.
// Only counts and points are stored (games, skill badges, points, tier, badges that year), never badge lists, names or passwords.
// The current season and the 4 seasons before it are kept; older ones are dropped automatically.
const STORE = 'site:seasons';
const KEEP = 5, MIN_YEAR = 2026, TIERS = ['', 'Trooper', 'Ranger', 'Champion', 'Legend'];
const J = (c, o) => ({ statusCode: c, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify(o) });
const mem = { hits: {} };
function bctx(e) {
  try {
    const siteID = (e.headers || {})['x-nf-site-id'] || process.env.SITE_ID;
    let d = null;
    if (e.blobs) d = JSON.parse(Buffer.from(e.blobs, 'base64').toString('utf8'));
    else if (process.env.NETLIFY_BLOBS_CONTEXT) { d = JSON.parse(Buffer.from(process.env.NETLIFY_BLOBS_CONTEXT, 'base64').toString('utf8')); d.url = d.url || d.edgeURL; }
    if (!d || !d.token || !(d.url || d.edgeURL) || !siteID) return null;
    return { url: d.url || d.edgeURL, fresh: d.uncachedEdgeURL || d.url || d.edgeURL, token: d.token, siteID };
  } catch { return null; }
}
const burl = (base, c, key) => new URL(`/${c.siteID}/${STORE}/${key}`, base).toString();
async function bget(c, key) {
  const r = await fetch(burl(c.fresh, c, key), { headers: { authorization: `Bearer ${c.token}` } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`read gave HTTP ${r.status}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
async function bset(c, key, val) {
  const r = await fetch(burl(c.url, c, key), { method: 'PUT', headers: { authorization: `Bearer ${c.token}` }, body: JSON.stringify(val) });
  if (!r.ok) throw new Error(`write gave HTTP ${r.status}`);
}
const num = (v, max, step) => { v = Number(v); if (!Number.isFinite(v) || v < 0 || v > max) return null; return step ? Math.round(v / step) * step : Math.round(v); };

exports.handler = async e => {
  const c = bctx(e);
  if (!c) return J(503, { ok: false, error: 'storage unavailable' });
  const ip = (e.headers || {})['x-nf-client-connection-ip'] || 'x', now = Date.now();
  const h = (mem.hits[ip] = (mem.hits[ip] || []).filter(t => now - t < 60e3));
  if (h.length >= 60) return J(429, { ok: false });
  h.push(now);
  try {
    if (e.httpMethod === 'GET') {
      const uid = String((e.queryStringParameters || {}).uid || '');
      if (!/^[a-z0-9-]{8,64}$/i.test(uid)) return J(400, { ok: false });
      const rec = await bget(c, 'u-' + uid.toLowerCase());
      return J(200, { ok: true, y: (rec && rec.y) || {} });
    }
    if (e.httpMethod !== 'POST') return J(405, { ok: false });
    let b; try { b = JSON.parse(e.body || '{}'); } catch { return J(400, { ok: false }); }
    const uid = String(b.uid || '');
    if (!/^[a-z0-9-]{8,64}$/i.test(uid) || !Array.isArray(b.seasons) || b.seasons.length > KEEP) return J(400, { ok: false });
    const maxYear = new Date().getUTCFullYear() + 1, key = 'u-' + uid.toLowerCase();
    const rec = (await bget(c, key)) || { y: {} };
    for (const s of b.seasons) {
      const y = Math.round(Number(s && s.y));
      const g = num(s.g, 5000), k = num(s.s, 5000), p = num(s.p, 5000, 0.5), bd = num(s.b, 5000);
      if (!(y >= MIN_YEAR && y <= maxYear) || g == null || k == null || p == null || bd == null) return J(400, { ok: false, error: 'bad season data' });
      const t = TIERS.includes(String(s.t || '')) ? String(s.t || '') : '';
      rec.y[y] = { g, s: k, p, t, b: bd, u: now };
    }
    const years = Object.keys(rec.y).map(Number).sort((a, z) => z - a);
    for (const y of years.slice(KEEP)) delete rec.y[y];
    await bset(c, key, rec);
    return J(200, { ok: true, y: rec.y });
  } catch (err) { return J(500, { ok: false, error: 'storage problem' }); }
};
