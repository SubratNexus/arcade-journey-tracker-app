// Site pulse: live viewers, total unique profiles and one star rating per profile.
//
// PRIMARY storage: Netlify Blobs, Netlify's own built-in storage (free, no account, no setup).
// Read from the open-source @netlify/blobs client (github.com/netlify/blobs): functions written as
// `exports.handler` receive their storage credentials on the request as `event.blobs`
// (base64 JSON {token, url}) and the site id in the `x-nf-site-id` header, and a site-wide store
// named "x" lives at  {url}/{siteID}/site:x/{key}  (note the "site:" prefix; earlier versions of this
// file left it out, so every read and write went to a path that does not exist).
// BACKUP storage: Abacus (abacus.jasoncameron.dev), a free public counter, used only if Netlify
// storage is unreachable. The reply always says which one answered (`backend`) and why, if any failed.
const STORE = 'site:sitestats';
const mem = { live: {}, seen: {}, rated: {} };   // this instance's recent writes (covers Blobs' short caching)
const hits = new Map();
const J = (c, o) => ({ statusCode: c, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify(o) });
const ID = /^[a-z0-9-]{8,64}$/i;

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
  if (!r.ok) throw new Error(`read ${key} gave HTTP ${r.status}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
async function bset(c, key, val) {
  const r = await fetch(burl(c.url, c, key), { method: 'PUT', headers: { authorization: `Bearer ${c.token}`, 'cache-control': 'max-age=0, stale-while-revalidate=60' }, body: JSON.stringify(val) });
  if (!r.ok) throw new Error(`write ${key} gave HTTP ${r.status}`);
}

// ---- backup: Abacus -------------------------------------------------------------------------
const AB = 'https://abacus.jasoncameron.dev', NS = 'subratnexa-arcade-tracker';
async function ab(path) {
  const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 4500);
  try {
    const r = await fetch(`${AB}/${path}`, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (r.status === 404) return { v: 0 };
    if (!r.ok) return { v: null, diag: `counter service HTTP ${r.status}` };
    const j = JSON.parse(await r.text()), n = Number(j && j.value);
    return Number.isFinite(n) ? { v: n } : { v: null, diag: 'counter service sent no number' };
  } catch (err) { return { v: null, diag: 'counter service: ' + err.message }; } finally { clearTimeout(t); }
}
async function abacus(body, uid) {
  let counted = false, rated = false, diag = null;
  if (uid && body.first === true) { const r = await ab(`hit/${NS}/total-views`); if (r.v != null) counted = true; else diag = r.diag; }
  const v = Math.round(Number(body.value));
  if (body.action === 'rate' && uid && body.canRate === true && v >= 1 && v <= 5) { const r = await ab(`hit/${NS}/stars-${v}`); if (r.v != null) rated = true; else diag = diag || r.diag; }
  const rs = await Promise.all(['total-views', 'stars-1', 'stars-2', 'stars-3', 'stars-4', 'stars-5'].map(k => ab(`get/${NS}/${k}`)));
  const bad = rs.find(r => r.diag); diag = diag || (bad && bad.diag);
  const st = rs.slice(1).map(r => r.v || 0), count = st.reduce((x, y) => x + y, 0);
  return { total: rs[0].v || 0, count, avg: count ? Math.round(st.reduce((x, n, i) => x + n * (i + 1), 0) / count * 10) / 10 : 0, counted, rated, diag };
}

exports.handler = async e => {
  const ip = (e.headers || {})['x-nf-client-connection-ip'] || 'x', now = Date.now();
  const a = (hits.get(ip) || []).filter(t => now - t < 6e4);
  if (a.length >= 40) return J(429, { ok: false });
  a.push(now); hits.set(ip, a);
  let body = {}; try { body = JSON.parse(e.body || '{}'); } catch {}
  const id = typeof body.id === 'string' && ID.test(body.id) ? body.id : null;          // this device (for "live")
  const uid = typeof body.uid === 'string' && ID.test(body.uid) ? body.uid : '';          // this Google Skills profile (for views and rating)
  if (!id) return J(400, { ok: false });
  const name = typeof body.name === 'string' ? body.name.slice(0, 60) : '';
  const stars = Math.round(Number(body.value)), rate = body.action === 'rate' && uid && stars >= 1 && stars <= 5;

  mem.live[id] = now;
  for (const k in mem.live) if (now - mem.live[k] > 9e4) delete mem.live[k];
  for (const k in mem.seen) if (now - mem.seen[k] > 12e4) delete mem.seen[k];
  for (const k in mem.rated) if (now - mem.rated[k].t > 12e4) delete mem.rated[k];

  const out = { ok: true, backend: 'memory', canRerate: false };
  let diag = null;
  const c = bctx(e);
  if (!c) diag = 'Netlify storage details were not sent to this function';
  else {
    try {
      const [live0, st0] = await Promise.all([bget(c, 'live'), bget(c, 'stats')]);
      const live = Object.assign({}, live0 || {}); for (const k in mem.live) live[k] = Math.max(live[k] || 0, mem.live[k]);
      for (const k in live) if (now - live[k] > 9e4) delete live[k];
      const st = { total: (st0 && st0.total) || 0, seen: Object.assign({}, st0 && st0.seen), ratings: Object.assign({}, st0 && st0.ratings), names: Object.assign({}, st0 && st0.names), watchSecs: (st0 && st0.watchSecs) || 0, sessions: (st0 && st0.sessions) || 0, mailed: st0 && st0.mailed, mailLock: (st0 && st0.mailLock) || 0 };
      for (const k in mem.seen) st.seen[k] = 1;
      for (const k in mem.rated) st.ratings[k] = mem.rated[k].v;
      st.total = Math.max(st.total, Object.keys(st.seen).length);
      let changed = false;
      if (uid && !st.seen[uid]) { st.seen[uid] = 1; st.total++; changed = true; mem.seen[uid] = now; }
      if (uid && name && st.names[uid] !== name) { st.names[uid] = name; changed = true; }
      if (rate && st.ratings[uid] !== stars) { st.ratings[uid] = stars; changed = true; mem.rated[uid] = { v: stars, t: now }; }
      // watch time: the browser reports how long a visit lasted when it is closed or hidden
      if (body.action === 'time') {
        const secs = Math.max(0, Math.min(4 * 3600, Math.round(Number(body.secs) || 0)));
        if (secs >= 3) { st.watchSecs += secs; if (body.sess === true) st.sessions++; changed = true; }
      }
      // email digest: one mail for every 25 unique profiles. The browser sends it, then confirms with action "mailed".
      const due = Math.floor(st.total / 25) * 25;
      if (st.mailed == null) { st.mailed = due; changed = true; }
      if (body.action === 'mailed') { const m = Math.round(Number(body.milestone)); if (m > st.mailed && m <= due) { st.mailed = m; changed = true; } }
      let mail = null;
      if (due > 0 && due > st.mailed && now - st.mailLock > 3e5 && body.action !== 'time') {
        st.mailLock = now; changed = true;
        const rv = Object.values(st.ratings), sessions = st.sessions || 0;
        mail = { milestone: due, total: st.total, ratings: rv.length, avgRating: rv.length ? Math.round(rv.reduce((x, y) => x + y, 0) / rv.length * 10) / 10 : 0, live: Object.keys(live).length, sessions, avgWatchHours: sessions ? Math.round(st.watchSecs / sessions / 36) / 100 : 0, totalWatchHours: Math.round(st.watchSecs / 36) / 100 };
      }
      live[id] = now;
      await bset(c, 'live', live);
      if (changed) await bset(c, 'stats', st);
      const vals = Object.values(st.ratings);
      if (mail) out.mail = mail;
      Object.assign(out, { backend: 'blobs', canRerate: true, live: Object.keys(live).length, total: st.total, count: vals.length, avg: vals.length ? Math.round(vals.reduce((x, y) => x + y, 0) / vals.length * 10) / 10 : 0, mine: uid ? (st.ratings[uid] || 0) : 0, rated: !!(rate && st.ratings[uid] === stars), counted: !!uid });
      return J(200, out);
    } catch (err) { diag = 'Netlify storage: ' + err.message; }
  }
  const r = await abacus(body, uid);
  Object.assign(out, { backend: r.diag && !r.total ? 'memory' : 'abacus', live: Object.keys(mem.live).length, total: r.total, avg: r.avg, count: r.count, counted: r.counted, rated: r.rated, d: diag + (r.diag ? ' | ' + r.diag : '') });
  return J(200, out);
};
