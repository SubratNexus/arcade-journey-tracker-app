import crypto from "node:crypto";

const STORE_NAME = "arcade-user-profiles";
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const rate = new Map();
const ALLOWED_HOSTS = new Set(["skills.google", "www.skills.google", "cloudskillsboost.google", "www.cloudskillsboost.google"]);
const json = (payload, status = 200) => Response.json(payload, {
  status,
  headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" }
});
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

function accountPrefix(userId) {
  return "u-" + crypto.createHash("sha256").update(String(userId)).digest("hex").slice(0, 40);
}
function allowedOrigin(request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return true;
  try { return new URL(origin).host === host; } catch { return false; }
}
function rateAllowed(userId) {
  const now = Date.now();
  const hits = (rate.get(userId) || []).filter(t => now - t < 60_000);
  if (hits.length >= 90) { rate.set(userId, hits); return false; }
  hits.push(now); rate.set(userId, hits);
  return true;
}

export default async function handler(request) {
  try {
    const [{ getUser }, { getStore }] = await Promise.all([import("@netlify/identity"), import("@netlify/blobs")]);
    const user = await getUser();
    if (!user || !user.id) return json({ ok: false, error: "Sign in to your Arcade account to use private cloud sync." }, 401);
    if (!allowedOrigin(request)) return json({ ok: false, error: "Cross-site request blocked." }, 403);
    if (!rateAllowed(user.id)) return json({ ok: false, error: "Too many cloud sync requests. Please try again shortly." }, 429);

    const store = getStore({ name: STORE_NAME, consistency: "strong" });
    const prefix = accountPrefix(user.id);
    const url = new URL(request.url);

    if (request.method === "GET") {
      if (url.searchParams.get("m") === "list") {
        const index = await store.get(prefix + "-index", { type: "json", consistency: "strong" });
        return json({ ok: true, user: { email: user.email || null }, profiles: Array.isArray(index?.profiles) ? index.profiles : [], lastUid: index?.lastUid || null });
      }
      const uid = String(url.searchParams.get("uid") || "").toLowerCase();
      if (!/^[a-z0-9-]{8,64}$/.test(uid)) return json({ ok: false, error: "Invalid public profile ID." }, 400);
      const record = await store.get(prefix + "-p-" + uid, { type: "json", consistency: "strong" });
      return json({ ok: true, exists: !!(record && record.data), data: record?.data || null, savedAt: record?.savedAt || null, user: { email: user.email || null } });
    }

    if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return json({ ok: false, error: "Profile backup is too large." }, 413);
    let body;
    try { body = JSON.parse(raw || "{}"); } catch { return json({ ok: false, error: "Invalid JSON." }, 400); }
    const uid = String(body.uid || "").toLowerCase();
    if (!/^[a-z0-9-]{8,64}$/.test(uid)) return json({ ok: false, error: "Invalid public profile ID." }, 400);
    const recordKey = prefix + "-p-" + uid;
    const indexKey = prefix + "-index";

    if (body.action === "delete") {
      await store.delete(recordKey);
      const index = await store.get(indexKey, { type: "json", consistency: "strong" });
      const profiles = (Array.isArray(index?.profiles) ? index.profiles : []).filter(p => p && p.uid !== uid);
      await store.setJSON(indexKey, { profiles, lastUid: index?.lastUid === uid ? (profiles[0]?.uid || null) : (index?.lastUid || null), updatedAt: Date.now() });
      return json({ ok: true, deleted: true });
    }

    if (body.action !== "save") return json({ ok: false, error: "Unknown profile backup action." }, 400);
    const data = cleanData(body.data, uid);
    if (!data.snapshot) return json({ ok: false, error: "A valid public profile snapshot is required before saving." }, 400);
    const encoded = JSON.stringify(data);
    if (Buffer.byteLength(encoded, "utf8") > MAX_BODY_BYTES) return json({ ok: false, error: "Profile backup is too large." }, 413);

    const now = Date.now();
    await store.setJSON(recordKey, { savedAt: now, data });
    const previous = await store.get(indexKey, { type: "json", consistency: "strong" });
    const list = Array.isArray(previous?.profiles) ? previous.profiles.filter(p => p && p.uid !== uid) : [];
    list.unshift({ uid, url: data.snapshot.url, name: data.snapshot.name, league: data.snapshot.league, badges: data.snapshot.badges.length, savedAt: now });
    await store.setJSON(indexKey, { profiles: list.slice(0, 5), lastUid: uid, updatedAt: now });
    return json({ ok: true, savedAt: now, bytes: Buffer.byteLength(encoded, "utf8"), user: { email: user.email || null } });
  } catch (error) {
    console.error("[profile-data]", error?.message || error);
    return json({ ok: false, error: "Private cloud backup failed. Your local data has not been removed." }, 500);
  }
}

export const _test = { uidForUrl, validProfileUrl, cleanSnapshot, cleanData, accountPrefix, storeName: "arcade-user-profiles", storeRegion: "strong" };
