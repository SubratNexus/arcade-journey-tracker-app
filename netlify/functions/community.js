// Community updates: public list + a hidden developer login so the owner can post news (text, image, GIF, short video, link)
// without redeploying. Posts live in Netlify Blobs until deleted.
// SECURITY: the password is NOT in this file or in the website. Only a salted scrypt hash is, so reading the code does not reveal it.
// You can replace the hash without editing code by setting the ADMIN_PASSWORD_HASH environment variable (format salt:hash, see tools/make-hash.js).
const crypto = require('crypto');
const STORE = 'site:community';
const HASH = process.env.ADMIN_PASSWORD_HASH || '34d094e6f9dd5d7d79fbef5e60b3f176:e7f745b602491e7455af4f69e12691a97836cc704f9e8efbba9b68d0f0520ae9';
const SECRET = process.env.TOKEN_SECRET || crypto.createHash('sha256').update('arcade-dev|' + HASH).digest('hex');
const TOKEN_MS = 2 * 3600e3, MAX_MEDIA = 4 * 1024 * 1024, MAX_POSTS = 100;
const MIMES = { 'image/jpeg': 'image', 'image/png': 'image', 'image/webp': 'image', 'image/gif': 'gif', 'video/mp4': 'video', 'video/webm': 'video' };
const J = (c, o, h) => ({ statusCode: c, headers: Object.assign({ 'content-type': 'application/json', 'cache-control': 'no-store' }, h || {}), body: JSON.stringify(o) });
const mem = { fails: {} };

// ---- Netlify Blobs over plain HTTP (same method as views.js, no packages needed) ----
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
  const r = await fetch(burl(c.url, c, key), { method: 'PUT', headers: { authorization: `Bearer ${c.token}` }, body: JSON.stringify(val) });
  if (!r.ok) throw new Error(`write ${key} gave HTTP ${r.status}`);
}
async function bdel(c, key) { try { await fetch(burl(c.url, c, key), { method: 'DELETE', headers: { authorization: `Bearer ${c.token}` } }); } catch {} }

// ---- password + token ----
function passOk(pw) {
  try {
    const [salt, hex] = HASH.split(':');
    const d = crypto.scryptSync(String(pw), Buffer.from(salt, 'hex'), 32, { N: 16384, r: 8, p: 1 });
    const h = Buffer.from(hex, 'hex');
    return d.length === h.length && crypto.timingSafeEqual(d, h);
  } catch { return false; }
}
const sign = b => crypto.createHmac('sha256', SECRET).update(b).digest('base64url');
function mint() { const b = Buffer.from(JSON.stringify({ exp: Date.now() + TOKEN_MS })).toString('base64url'); return b + '.' + sign(b); }
function tokenOk(h) {
  try {
    const t = String((h || {}).authorization || '').replace(/^Bearer\s+/i, '');
    const [b, s] = t.split('.');
    if (!b || !s) return false;
    const x = Buffer.from(sign(b)), y = Buffer.from(s);
    if (x.length !== y.length || !crypto.timingSafeEqual(x, y)) return false;
    return JSON.parse(Buffer.from(b, 'base64url').toString('utf8')).exp > Date.now();
  } catch { return false; }
}
const httpsUrl = (u, max) => { u = String(u || '').trim().slice(0, max || 500); try { const x = new URL(u); return x.protocol === 'https:' ? x.toString() : ''; } catch { return ''; } };
const pub = (p) => ({ id: p.id, t: p.t, title: p.title, body: p.body, link: p.link, linkLabel: p.linkLabel, pin: !!p.pin, media: p.media ? { type: p.media.type, src: p.media.ref ? '/api/community?m=' + p.media.ref : p.media.url } : null });

exports.handler = async e => {
  const c = bctx(e), q = e.queryStringParameters || {}, method = e.httpMethod;
  if (!c) return J(503, { ok: false, error: 'Netlify storage is not available to this function yet.' });
  try {
    if (method === 'GET') {
      if (q.m) {
        if (!/^[a-z0-9]{6,40}$/i.test(q.m)) return J(400, { ok: false });
        const m = await bget(c, 'm-' + q.m);
        if (!m) return J(404, { ok: false });
        return { statusCode: 200, isBase64Encoded: true, headers: { 'content-type': m.mime, 'cache-control': 'public, max-age=86400', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'" }, body: m.b64 };
      }
      const posts = (await bget(c, 'posts')) || [];
      const catalog = (await bget(c, 'catalog')) || { entries: [], keywords: { game: [], skill: [] } };
      return J(200, { ok: true, posts: posts.map(pub), catalog: { entries: Array.isArray(catalog.entries)?catalog.entries:[], keywords: catalog.keywords||{game:[],skill:[]} }, agentFeedUrl: typeof catalog.agentFeedUrl === 'string' ? catalog.agentFeedUrl : '' }, { 'cache-control': 'public, max-age=20' });
    }
    if (method !== 'POST') return J(405, { ok: false });
    let b = {}; try { b = JSON.parse(e.body || '{}'); } catch { return J(400, { ok: false, error: 'Request body must be valid JSON.' }); }
    const ip = (e.headers || {})['x-nf-client-connection-ip'] || 'x', now = Date.now();

    if (b.action === 'login') {
      const f = (await bget(c, 'authfail').catch(() => null)) || { n: 0, until: 0 };
      const mf = mem.fails[ip] || { n: 0, until: 0 };
      if (now < Math.max(f.until || 0, mf.until || 0)) return J(429, { ok: false, error: 'Too many attempts. Try again later.' });
      if (passOk(b.password)) { mem.fails[ip] = { n: 0, until: 0 }; if (f.n) await bset(c, 'authfail', { n: 0, until: 0 }); return J(200, { ok: true, token: mint(), expiresIn: TOKEN_MS }); }
      const n = (f.n || 0) + 1, until = n >= 5 ? now + 15 * 60e3 : 0;
      mem.fails[ip] = { n, until };
      await bset(c, 'authfail', { n: until ? 0 : n, until }).catch(() => {});
      await new Promise(r => setTimeout(r, 600));
      return J(401, { ok: false, error: 'Wrong password.' });
    }

    if (!tokenOk(e.headers)) return J(401, { ok: false, error: 'Please log in again.' });

    if (b.action === 'post') {
      const title = String(b.title || '').trim().slice(0, 120), body = String(b.body || '').trim().slice(0, 2000);
      if (!title && !body) return J(400, { ok: false, error: 'Write a title or some text.' });
      const link = b.link ? httpsUrl(b.link) : '', id = now.toString(36) + crypto.randomBytes(3).toString('hex');
      if (b.link && !link) return J(400, { ok: false, error: 'The link must start with https://' });
      const post = { id, t: now, title, body, link, linkLabel: String(b.linkLabel || 'Open link').trim().slice(0, 30), pin: !!b.pin, media: null };
      const m = b.media;
      if (m && m.b64) {
        const kind = MIMES[m.mime];
        if (!kind) return J(400, { ok: false, error: 'Use a JPG, PNG, WebP, GIF, MP4 or WebM file.' });
        const buf = Buffer.from(String(m.b64), 'base64');
        if (!buf.length || buf.length > MAX_MEDIA) return J(400, { ok: false, error: 'File is too big. Keep it under 4 MB or paste a link instead.' });
        const ref = id; await bset(c, 'm-' + ref, { mime: m.mime, b64: buf.toString('base64') });
        post.media = { type: kind, ref };
      } else if (m && m.url) {
        const url = httpsUrl(m.url); if (!url) return J(400, { ok: false, error: 'The media link must start with https://' });
        post.media = { type: ['image', 'gif', 'video'].includes(m.type) ? m.type : 'image', url };
      }
      let posts = (await bget(c, 'posts')) || [];
      posts.unshift(post);
      for (const old of posts.slice(MAX_POSTS)) if (old.media && old.media.ref) await bdel(c, 'm-' + old.media.ref);
      posts = posts.slice(0, MAX_POSTS);
      await bset(c, 'posts', posts);
      return J(200, { ok: true, post: pub(post) });
    }
    if (b.action === 'delete') {
      const posts = (await bget(c, 'posts')) || [], p = posts.find(x => x.id === b.id);
      if (!p) return J(404, { ok: false, error: 'Not found.' });
      if (p.media && p.media.ref) await bdel(c, 'm-' + p.media.ref);
      await bset(c, 'posts', posts.filter(x => x.id !== b.id));
      return J(200, { ok: true });
    }
    if (b.action === 'catalog_save') {
      const raw = Array.isArray(b.entries) ? b.entries.slice(0, 400) : [];
      const seen = new Set(), entries = [];
      for (const r of raw) {
        if (!r || typeof r.title !== 'string') continue;
        const title = r.title.trim().replace(/\s+/g,' ').slice(0,140), key = title.toLowerCase();
        if (title.length < 2 || seen.has(key)) continue; seen.add(key);
        const aliases = Array.isArray(r.aliases) ? [...new Set(r.aliases.map(x=>String(x).trim().replace(/\s+/g,' ').slice(0,140)).filter(x=>x.length>=2))].slice(0,12) : [];
        entries.push({title,aliases,status:r.status==='retired'?'retired':'active'});
      }
      const cleanList = v => Array.isArray(v) ? [...new Set(v.map(x=>String(x).toLowerCase().trim().replace(/\s+/g,' ').slice(0,90)).filter(x=>x.length>=3))].slice(0,150) : [];
      const keywords = {game:cleanList(b.keywords&&b.keywords.game),skill:cleanList(b.keywords&&b.keywords.skill)};
      const existing = (await bget(c, 'catalog')) || {};
      await bset(c,'catalog',{entries,keywords,agentFeedUrl:typeof existing.agentFeedUrl==='string'?existing.agentFeedUrl:'',updated:now});
      return J(200,{ok:true,entries:entries.length,gameKeywords:keywords.game.length,skillKeywords:keywords.skill.length});
    }
    if (b.action === 'agent_feed_save') {
      const raw = String(b.url || '').trim();
      let url = '';
      if (raw) {
        try {
          const u = new URL(raw);
          const validPath = /^\/[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,80}\/agent-data\/catalogue\.json$/.test(u.pathname);
          if (u.protocol !== 'https:' || u.hostname !== 'raw.githubusercontent.com' || u.search || u.hash || !validPath) {
            return J(400, { ok: false, error: 'Use the public raw.githubusercontent.com/.../agent-data/catalogue.json URL.' });
          }
          url = u.toString();
        } catch { return J(400, { ok: false, error: 'Enter a valid HTTPS GitHub raw catalogue URL.' }); }
      }
      const existing = (await bget(c, 'catalog')) || { entries: [], keywords: { game: [], skill: [] } };
      existing.agentFeedUrl = url;
      existing.updated = now;
      await bset(c, 'catalog', existing);
      return J(200, { ok: true, connected: !!url, url });
    }
    if (b.action === 'check') return J(200, { ok: true });
    return J(400, { ok: false, error: 'Unknown community action.' });
  } catch (err) { return J(500, { ok: false, error: 'Storage problem: ' + err.message }); }
};
