'use strict';

// Persistent per-public-profile backup for Arcade Journey Tracker.
// This stores public profile snapshots plus visitor-entered corrections/settings.
// It uses the same built-in Netlify Blobs context as seasons.js; no API key is needed.
const LEGACY_STORE = 'site:arcade-profiles';
// Reuse the existing site-wide store and its default region so previous backups remain visible.
const STORE = 'arcade-profiles';
const STORE_REGION = 'us-east-2';
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const ALLOWED_HOSTS = new Set(['skills.google', 'www.skills.google', 'cloudskillsboost.google', 'www.cloudskillsboost.google']);
const mem = { hits: Object.create(null) };
const J = (statusCode, payload) => ({
  statusCode,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  },
  body: JSON.stringify(payload)
});

function bctx(e) {
  try {
    const siteID = (e.headers || {})['x-nf-site-id'] || process.env.SITE_ID;
    let d = null;
    if (e.blobs) d = JSON.parse(Buffer.from(e.blobs, 'base64').toString('utf8'));
    else if (process.env.NETLIFY_BLOBS_CONTEXT) {
      d = JSON.parse(Buffer.from(process.env.NETLIFY_BLOBS_CONTEXT, 'base64').toString('utf8'));
      d.url = d.url || d.edgeURL;
    }
    if (!d || !d.token || !(d.url || d.edgeURL) || !siteID) return null;
    return { url: d.url || d.edgeURL, fresh: d.uncachedEdgeURL || d.url || d.edgeURL, token: d.token, siteID };
  } catch { return null; }
}
const burl = (base, c, key) => new URL(`/${c.siteID}/${LEGACY_STORE}/${key}`, base).toString();
async function bget(c, key) {
  const r = await fetch(burl(c.fresh, c, key), { headers: { authorization: `Bearer ${c.token}` } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`read failed (${r.status})`);
  const value = await r.text();
  return value ? JSON.parse(value) : null;
}
async function bset(c, key, value) {
  const r = await fetch(burl(c.url, c, key), {
    method: 'PUT', headers: { authorization: `Bearer ${c.token}`, 'content-type': 'application/json' },
    body: JSON.stringify(value)
  });
  if (!r.ok) throw new Error(`write failed (${r.status})`);
}
async function bdel(c, key) {
  const r = await fetch(burl(c.url, c, key), { method: 'DELETE', headers: { authorization: `Bearer ${c.token}` } });
  if (!r.ok && r.status !== 404) throw new Error(`delete failed (${r.status})`);
}

// Prefer Netlify's supported Blobs SDK while keeping the same site-wide store
// name and region used by the earlier HTTP implementation. This preserves old backups.
let sdkStorePromise;
async function getSdkStore() {
  if (!sdkStorePromise) sdkStorePromise = (async () => {
    try {
      const blobs = await import('@netlify/blobs');
      if (typeof blobs.getStore !== 'function') throw new Error('Netlify Blobs SDK does not expose getStore().');
      return blobs.getStore(STORE, { region: STORE_REGION });
    } catch (error) {
      if (error && error.code === 'ERR_MODULE_NOT_FOUND') return null;
      throw error;
    }
  })();
  return sdkStorePromise;
}
async function storeGet(event, key) {
  const store = await getSdkStore();
  if (store) {
    const current = await store.get(key, { type: 'json', consistency: 'strong' });
    if (current) return current;
    const legacyContext = bctx(event);
    if (legacyContext) {
      const legacy = await bget(legacyContext, key);
      if (legacy) {
        await store.setJSON(key, legacy);
        return legacy;
      }
    }
    return null;
  }
  const legacyContext = bctx(event);
  if (!legacyContext) throw new Error('Netlify Blobs SDK is not installed and legacy storage context is unavailable.');
  return bget(legacyContext, key);
}
async function storeSet(event, key, value) {
  const store = await getSdkStore();
  if (store) return store.setJSON(key, value);
  const legacyContext = bctx(event);
  if (!legacyContext) throw new Error('Netlify Blobs storage is unavailable.');
  return bset(legacyContext, key, value);
}
async function storeDelete(event, key) {
  const store = await getSdkStore();
  if (store) {
    await store.delete(key);
    const legacyContext = bctx(event);
    if (legacyContext) await bdel(legacyContext, key);
    return;
  }
  const legacyContext = bctx(event);
  if (!legacyContext) throw new Error('Netlify Blobs storage is unavailable.');
  await bdel(legacyContext, key);
}

function uidForUrl(value) {
  const raw = String(value || '');
  const match = raw.match(/public_profiles\/([a-z0-9-]{8,64})/i);
  if (match) return match[1].toLowerCase();
  let hash = 5381;
  for (let i = 0; i < raw.length; i++) hash = (hash * 33 ^ raw.charCodeAt(i)) >>> 0;
  return 'p' + hash.toString(16).padStart(8, '0');
}
function validProfileUrl(value, uid) {
  try {
    const u = new URL(String(value || ''));
    return u.protocol === 'https:' && ALLOWED_HOSTS.has(u.hostname) && u.pathname.startsWith('/public_profiles/') && uidForUrl(u.toString()) === uid;
  } catch { return false; }
}
const asObject = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
const boundedText = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
function cleanMap(value, allowedValues = null, max = 3000) {
  const out = {};
  for (const [key, val] of Object.entries(asObject(value)).slice(0, max)) {
    const k = boundedText(key, 260);
    const v = boundedText(val, 30);
    if (k && (!allowedValues || allowedValues.has(v))) out[k] = v;
  }
  return out;
}
function cleanSnapshot(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.badges) || value.badges.length > 5000) return null;
  const url = boundedText(value.url, 500);
  const uid = uidForUrl(url);
  if (!validProfileUrl(url, uid)) return null;
  const badges = value.badges.map(b => {
    if (!b || typeof b !== 'object') return null;
    const title = boundedText(b.title, 180);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) ? String(b.date) : null;
    if (!title) return null;
    const item = { key: boundedText(b.key || (title + '|' + (date || '')), 260), title, date, sk: b.sk === true ? true : b.sk === false ? false : null };
    if (b.iu) item.iu = boundedText(b.iu, 500);
    if (b.img && typeof b.img === 'object') item.img = { k: boundedText(b.img.k, 30), score: Number.isFinite(Number(b.img.score)) ? Math.max(0, Math.min(1, Number(b.img.score))) : 0 };
    return item;
  }).filter(Boolean);
  return {
    url, name: boundedText(value.name || 'Learner', 60), league: boundedText(value.league, 60) || null,
    since: boundedText(value.since, 60) || null, noModal: value.noModal === true,
    pages: Math.max(1, Math.min(100, Math.round(Number(value.pages) || 1))), badges,
    t: Math.max(0, Math.min(Date.now() + 86400000, Number(value.t) || Date.now())), src: 'fetch'
  };
}
function cleanProfileList(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const p of value.slice(0, 5)) {
    const snap = cleanSnapshot(p && p.snap);
    if (!snap) continue;
    out.push({ url: snap.url, name: snap.name, league: snap.league, badges: snap.badges.length,
      savedAt: Math.max(0, Math.min(Date.now() + 86400000, Number(p.savedAt) || Date.now())), snap });
  }
  return out;
}
function cleanManualPoints(value) {
  const out = {};
  for (const [uid, entries] of Object.entries(asObject(value)).slice(0, 8)) {
    if (!/^[a-z0-9-]{8,64}$/i.test(uid) || !Array.isArray(entries)) continue;
    out[uid] = entries.slice(-200).map(x => {
      const points = Number(x && x.points), date = String(x && x.date || '');
      if (!Number.isFinite(points) || points < 0.5 || points > 1000 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
      return { id: boundedText(x.id, 40) || Date.now().toString(36), event: boundedText(x.event, 80), points: Math.round(points * 100) / 100, date };
    }).filter(x => x && x.event.length >= 2);
  }
  return out;
}
function cleanConfig(value) {
  const x = asObject(value), out = {};
  for (const k of ['live', 'win', 'floor', 'fac', 'bms', 'img', 'fest', 'seas']) if (typeof x[k] === 'boolean') out[k] = x[k];
  if ([0.5, 1, 2, 5, 15].includes(Number(x.every))) out.every = Number(x.every);
  if (['yes', 'no'].includes(x.unk)) out.unk = x.unk;
  return out;
}
function cleanData(raw, uid) {
  const x = asObject(raw);
  const snapshot = cleanSnapshot(x.snapshot);
  if (snapshot && uidForUrl(snapshot.url) !== uid) throw new Error('Profile URL does not match its storage key.');
  const profiles = cleanProfileList(x.profiles);
  const keywords = v => Array.isArray(v) ? [...new Set(v.map(k => boundedText(k, 90).toLowerCase()).filter(k => k.length >= 3))].slice(0, 150) : [];
  const snaps = Array.isArray(x.snaps) ? x.snaps.slice(-60).map(s => ({ t: Math.max(0, Number(s.t) || 0), b: Math.max(0, Math.min(5000, Number(s.b) || 0)), a: Math.max(0, Math.min(5000, Number(s.a) || 0)), p: Math.max(0, Math.min(10000, Number(s.p) || 0)), v: boundedText(s.v, 60) })) : [];
  const updates = Array.isArray(x.updates) ? x.updates.slice(0, 100).map(u => ({ id: boundedText(u.id, 40), t: Math.max(0, Number(u.t) || 0), k: boundedText(u.k, 30), title: boundedText(u.title, 150), date: boundedText(u.date, 20), pts: Math.max(0, Math.min(10000, Number(u.pts) || 0)), note: boundedText(u.note, 240), n: u.n ? 1 : 0 })) : [];
  const goal = ['Trooper', 'Ranger', 'Champion', 'Legend', 'Custom'].includes(x.goal) ? x.goal : 'Legend';
  const customGoal = Math.max(50, Math.min(5000, Number(x.customGoal) || 100));
  const maxSeason = new Date().getUTCFullYear();
  const seasonYear = Number.isInteger(Number(x.seasonYear)) && Number(x.seasonYear) >= 2026 && Number(x.seasonYear) <= maxSeason ? Number(x.seasonYear) : maxSeason;
  return {
    version: 1, uid, savedAt: Date.now(), snapshot, profiles, seasonYear,
    overrides: cleanMap(x.overrides, new Set(['game', 'trivia', 'special', 'skill', 'no'])),
    learned: cleanMap(x.learned, new Set(['game', 'trivia'])), manualPoints: cleanManualPoints(x.manualPoints),
    config: cleanConfig(x.config), goal, customGoal, gameKeywords: keywords(x.gameKeywords), skillKeywords: keywords(x.skillKeywords),
    snapshots: snaps, updates
  };
}

exports.handler = async event => {
  const headers = event.headers || {};
  const origin = headers.origin;
  const host = headers.host;
  if (origin && host) {
    try { if (new URL(origin).host !== host) return J(403, { ok: false, error: 'Cross-site request blocked.' }); }
    catch { return J(403, { ok: false }); }
  }
  const ip = headers['x-nf-client-connection-ip'] || 'unknown';
  const now = Date.now();
  mem.hits[ip] = (mem.hits[ip] || []).filter(t => now - t < 60000);
  if (mem.hits[ip].length >= 90) return J(429, { ok: false, error: 'Too many profile backup requests. Try again shortly.' });
  mem.hits[ip].push(now);
  try {
    const query = event.queryStringParameters || {};
    if (event.httpMethod === 'GET') {
      const uid = String(query.uid || '').toLowerCase();
      if (!/^[a-z0-9-]{8,64}$/.test(uid)) return J(400, { ok: false, error: 'Invalid public profile ID.' });
      const record = await storeGet(event, 'p-' + uid);
      return J(200, { ok: true, exists: !!(record && record.data), data: record && record.data || null, savedAt: record && record.savedAt || null });
    }
    if (event.httpMethod !== 'POST') return J(405, { ok: false, error: 'Method not allowed.' });
    const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : String(event.body || '');
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return J(413, { ok: false, error: 'Profile backup is too large. Reduce the number of saved profiles and try again.' });
    let body; try { body = JSON.parse(raw || '{}'); } catch { return J(400, { ok: false, error: 'Invalid JSON.' }); }
    const uid = String(body.uid || '').toLowerCase();
    if (!/^[a-z0-9-]{8,64}$/.test(uid)) return J(400, { ok: false, error: 'Invalid public profile ID.' });
    const key = 'p-' + uid;
    if (body.action === 'delete') {
      await storeDelete(event, key);
      return J(200, { ok: true, deleted: true });
    }
    if (body.action !== 'save') return J(400, { ok: false, error: 'Unknown profile backup action.' });
    const data = cleanData(body.data, uid);
    if (!data.snapshot) return J(400, { ok: false, error: 'A valid public profile snapshot is required before saving.' });
    if (Buffer.byteLength(JSON.stringify(data), 'utf8') > MAX_BODY_BYTES) return J(413, { ok: false, error: 'Profile backup is too large.' });
    await storeSet(event, key, { savedAt: now, data });
    return J(200, { ok: true, savedAt: now, bytes: Buffer.byteLength(JSON.stringify(data), 'utf8') });
  } catch (error) {
    console.error('[profile-data]', error && error.message || error);
    return J(500, { ok: false, error: 'Profile cloud backup failed. Your local data has not been removed.' });
  }
};

exports._test = { uidForUrl, validProfileUrl, cleanSnapshot, cleanData, storeName: STORE, storeRegion: STORE_REGION };
