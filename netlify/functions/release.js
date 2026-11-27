// Hot updates ("release bucket"): the current browser extracts app HTML from a project ZIP, then the owner approves by email
// without a new Netlify deploy. The service stores only extracted app.html; its small ZIP parser is retained for legacy clients.
//
// SECURITY MODEL (two separate keys):
//   1) The developer password (checked by community.js, which hands out a short-lived signed token) is needed to UPLOAD.
//   2) The owner's email inbox is needed to APPROVE. The approval link is created and e-mailed by THIS SERVER, so the person who
//      uploaded never sees it. Nothing goes live until the owner clicks Approve on the page that link opens.
//   - The link is random (256 bits), single-use, expires in 30 minutes, and opens a page that only shows details (a mail scanner that
//     "visits" the link cannot approve; approving needs a button press).
//   - If the email cannot be sent, the upload is thrown away (fails closed).
//   - Emergency exit: open the site with ?builtin=1 to run the version that was deployed on Netlify.
const crypto = require('crypto'), zlib = require('zlib'), vm = require('vm');
const STORE = 'site:releases';
// Must match the public index.html and built-in app-builtin.html app-build markers.
// Built-in build 824 is the minimum foundation; hot releases must be 825 or higher.
const BASE_BUILD = 824;
const HASH = process.env.ADMIN_PASSWORD_HASH || '34d094e6f9dd5d7d79fbef5e60b3f176:e7f745b602491e7455af4f69e12691a97836cc704f9e8efbba9b68d0f0520ae9';
const SECRET = process.env.TOKEN_SECRET || crypto.createHash('sha256').update('arcade-dev|' + HASH).digest('hex');
const MAX_ZIP = 4 * 1024 * 1024, MAX_HTML = 1536 * 1024, MAX_FILES = 40, MAX_FILE = 3 * 1024 * 1024, MAX_TOTAL = 8 * 1024 * 1024, PENDING_MS = 30 * 60e3, KEEP_HIST = 5;
const EXT = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', ico: 'image/x-icon', txt: 'text/plain; charset=utf-8' };
const J = (c, o) => ({ statusCode: c, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify(o) });
const mem = { hits: {} };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');

// ---- Netlify Blobs over plain HTTP (same method as the other functions) ----
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
  const r = await fetch(burl(c.fresh, c, key), { headers: { authorization: `Bearer ${c.token}`, 'cache-control': 'no-cache' }, cache: 'no-store' });
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
const delFiles = async (c, rel) => { if (rel && rel.files) for (const f of rel.files) await bdel(c, `f-${rel.id}-${f.i}`); };

// ---- developer token (issued by community.js after the password is checked) ----
const sign = b => crypto.createHmac('sha256', SECRET).update(b).digest('base64url');
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

// ---- Legacy direct ZIP reading (no packages): stored + deflate, with CRC and size checks ----
const CRCT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = buf => { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRCT[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function parseZip(buf) {
  if (buf.length < 22 || buf.length > MAX_ZIP) throw new Error('The ZIP is empty or bigger than 4 MB. Hot updates are for small files such as app.html. Big files (like posters) need a normal Netlify deploy.');
  let e = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('This is not a valid ZIP file.');
  const n = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16);
  if (n > 300) throw new Error('Too many entries in the ZIP.');
  const out = []; let total = 0;
  for (let k = 0; k < n; k++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('The ZIP is damaged.');
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16), cs = buf.readUInt32LE(p + 20), us = buf.readUInt32LE(p + 24);
    const nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), lo = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl); p += 46 + nl + el + cl;
    if (name.endsWith('/') || /(^|\/)(\.DS_Store|__MACOSX)(\/|$)/.test(name)) continue;
    if (flags & 1) throw new Error('Password-protected ZIPs are not accepted.');
    if (cs === 0xFFFFFFFF || us === 0xFFFFFFFF) throw new Error('ZIP64 files are not accepted.');
    if (method !== 0 && method !== 8) throw new Error('Unsupported ZIP compression.');
    if (name.includes('\\') || name.startsWith('/') || name.includes('..') || name.includes('\0') || name.includes('//') || name.length > 120) throw new Error('Unsafe file name in the ZIP: ' + name.slice(0, 60));
    if (us > MAX_FILE) throw new Error(`${name} is too large (max 3 MB per file).`);
    total += us; if (total > MAX_TOTAL) throw new Error('The unpacked files are too large (max 8 MB in total).');
    if (lo + 30 > buf.length || buf.readUInt32LE(lo) !== 0x04034b50) throw new Error('The ZIP is damaged.');
    const ds = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28), raw = buf.subarray(ds, ds + cs);
    let data; try { data = method === 8 ? zlib.inflateRawSync(raw, { maxOutputLength: us + 1 }) : raw; } catch { throw new Error('Could not unpack ' + name); }
    if (data.length !== us || crc32(data) !== crc) throw new Error(name + ' is damaged inside the ZIP.');
    out.push({ p: name, data });
  }
  if (!out.length) throw new Error('The ZIP has no files.');
  if (!out.some(f => f.p === 'app.html')) { const top = new Set(out.map(f => f.p.split('/')[0])); if (top.size === 1 && out.every(f => f.p.includes('/'))) out.forEach(f => { f.p = f.p.slice(f.p.indexOf('/') + 1); }); }
  if (out.length > MAX_FILES) throw new Error('Too many files (max 40).');
  const seen = new Set();
  for (const f of out) {
    const ext = (f.p.split('.').pop() || '').toLowerCase();
    if (!EXT[ext]) throw new Error('File type not allowed: ' + f.p);
    if (ext === 'html' && f.p !== 'app.html') throw new Error('Only app.html may be an HTML file.');
    if (seen.has(f.p)) throw new Error('Duplicate file: ' + f.p); seen.add(f.p);
  }
  if (!seen.has('app.html')) throw new Error('The ZIP must contain app.html at the top level.');
  return out;
}
function checkApp(html) {
  if (Buffer.byteLength(html, 'utf8') < 20000) throw new Error('app.html looks too small to be the app.');
  if (!/<meta\s+name="app-id"\s+content="arcade-journey"\s*\/?>/i.test(html)) throw new Error('app.html is missing the Arcade Journey app-id marker, so it is probably the wrong file.');
  const m = html.match(/<meta\s+name="app-build"\s+content="(\d{1,6})"\s*\/?>/i);
  if (!m) throw new Error('app.html is missing its build number.');
  if (/<script[^>]+src\s*=\s*["']?(https?:)?\/\//i.test(html)) throw new Error('app.html loads a script from another website, which is not allowed.');
  if (/<iframe/i.test(html)) throw new Error('app.html contains an iframe, which is not allowed.');
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/gi; let s, cnt = 0;
  while ((s = re.exec(html))) { const attrs=s[1]||'', type=(attrs.match(/\btype\s*=\s*[\"']([^\"']+)/i)||[])[1]||''; if(/\bsrc\s*=/i.test(attrs)||type&&!/(?:java|ecma)script|module/i.test(type))continue; cnt++; try { new vm.Script(s[2]); } catch (err) { throw new Error('A script in app.html has a syntax error: ' + String(err.message).slice(0, 120)); } }
  if (!cnt) throw new Error('app.html has no script.');
  return +m[1];
}

// ---- email to the owner (the uploader never receives the approval link) ----
function mailConfiguration() {
  const keyReady = !!process.env.RESEND_API_KEY;
  const recipientReady = !!process.env.OWNER_EMAIL;
  const sender = String(process.env.MAIL_FROM || '').trim();
  const senderAddress = (sender.match(/<([^<>]+)>/) || [])[1] || sender;
  const senderIsResendTest = !sender || /@resend\.dev$/i.test(senderAddress);
  const senderLooksValid = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(senderAddress);
  const customSenderReady = senderLooksValid && !senderIsResendTest;
  const mailReady = keyReady && recipientReady;
  const mailSetupHint = !keyReady || !recipientReady
    ? 'Add RESEND_API_KEY and OWNER_EMAIL in Netlify Production environment variables.'
    : (customSenderReady
      ? 'A custom sender is configured. Confirm that its domain is verified in Resend.'
      : 'Resend shared test sender is in use. For reliable approval delivery, verify a domain you control in Resend and set MAIL_FROM to an address on that domain.');
  return { mailReady, mailSenderReady: customSenderReady, mailMode: customSenderReady ? 'custom-sender' : (mailReady ? 'resend-test-sender' : 'not-configured'), mailSetupHint };
}
async function mailOwner(subject, html, text) {
  const key = process.env.RESEND_API_KEY, to = process.env.OWNER_EMAIL;
  if (!key || !to) return { ok: false, why: 'not_configured' };
  const from = String(process.env.MAIL_FROM || 'Arcade Tracker <onboarding@resend.dev>').trim();
  try {
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' }, body: JSON.stringify({ from, to: [to], subject, html, text }) });
    if (r.ok) return { ok: true };
    const response = await r.json().catch(() => ({}));
    const detail = String(response.message || response.error || response.name || '').slice(0, 220);
    console.warn('[release-email] Resend rejected approval mail', r.status, detail);
    return { ok: false, why: r.status === 403 ? 'sender_not_authorized' : 'send_failed', status: r.status, detail };
  } catch (error) {
    console.warn('[release-email] Resend request failed', String(error && error.message || error).slice(0, 180));
    return { ok: false, why: 'network_error' };
  }
}
const baseUrl = e => (process.env.URL || '').replace(/\/$/, '') || 'https://' + ((e.headers || {})['x-forwarded-host'] || (e.headers || {}).host || 'localhost');
const when = t => new Date(t).toUTCString();
const page = (code, title, body) => ({ statusCode: code, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex', 'x-content-type-options': 'nosniff' }, body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>body{margin:0;font:16px/1.5 system-ui,sans-serif;background:#0b1020;color:#e8ecff;display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}main{max-width:520px;width:100%;background:#131a33;border:1px solid #27315a;border-radius:20px;padding:22px}h1{font-size:22px;margin:0 0 10px}table{width:100%;border-collapse:collapse;font-size:14px;margin:12px 0}td{padding:6px 0;border-top:1px solid #27315a;vertical-align:top}td:first-child{opacity:.7;width:38%}button{font:inherit;font-weight:700;border:0;border-radius:14px;padding:14px;width:100%;margin-top:10px;cursor:pointer}.ok{background:#2fd27a;color:#052}.no{background:#2a3358;color:#fff}.warn{background:#3a2a12;border:1px solid #f5b13d;border-radius:12px;padding:10px;font-size:14px}code{font-size:12px;word-break:break-all}</style></head><body><main>${body}</main></body></html>` });

async function activate(c, rel, prevActive) {
  if (!rel || !Number.isInteger(+rel.build) || +rel.build <= BASE_BUILD) throw new Error(`Release build must be newer than built-in build ${BASE_BUILD}.`);
  const hist = (await bget(c, 'hist')) || [];
  if (prevActive && prevActive.id !== rel.id) hist.unshift(prevActive);
  const keep = hist.filter(h => h.id !== rel.id).slice(0, KEEP_HIST);
  // Publish the active pointer only after all files are already stored.
  await bset(c, 'active', rel);
  const confirmed = await bget(c, 'active');
  if (!confirmed || confirmed.id !== rel.id || +confirmed.build !== +rel.build) throw new Error('The release was stored but could not be verified immediately. Refresh status before retrying.');
  await bset(c, 'hist', keep);
  for (const old of hist.filter(h => !keep.some(k => k.id === h.id) && h.id !== rel.id)) await delFiles(c, old);
}

exports.handler = async e => {
  const c = bctx(e), q = e.queryStringParameters || {}, method = e.httpMethod, now = Date.now();
  const ip = (e.headers || {})['x-nf-client-connection-ip'] || 'x';
  try {
    // ---- serve the live release to the homepage update checker (index.html) ----
    if (method === 'GET' && q.m === 'app') {
      const nocache = { 'cache-control': 'no-store, max-age=0, must-revalidate', 'netlify-cdn-cache-control': 'no-store', 'pragma': 'no-cache' };
      if (!c) return { statusCode: 204, headers: nocache, body: '' };
      const act = await bget(c, 'active'), b = parseInt(q.b, 10) || 0;
      // Reject old releases even if they were accepted by an earlier buggy version of this function.
      if (!act || !(+act.build > Math.max(BASE_BUILD, b))) return { statusCode: 204, headers: nocache, body: '' };
      const f = act.files.find(x => x.p === 'app.html'), blob = f && await bget(c, `f-${act.id}-${f.i}`);
      if (!blob) return { statusCode: 204, headers: nocache, body: '' };
      return { statusCode: 200, headers: Object.assign({ 'content-type': 'text/html; charset=utf-8', 'x-release-id': act.id }, nocache), body: Buffer.from(blob.b64, 'base64').toString('utf8') };
    }
    if (method === 'GET' && q.m === 'file') {
      const act = c && await bget(c, 'active'), f = act && +act.build > BASE_BUILD && act.files.find(x => x.p === String(q.p || '') && x.p !== 'app.html');
      if (!f) return { statusCode: 404, body: '' };
      const blob = await bget(c, `f-${act.id}-${f.i}`);
      if (!blob) return { statusCode: 404, body: '' };
      return { statusCode: 200, isBase64Encoded: true, headers: { 'content-type': blob.ct, 'cache-control': 'public, max-age=300', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" }, body: blob.b64 };
    }
    if (method === 'GET' && q.m === 'health') {
      if (!c) return J(503, { ok: false, service: 'release', storageReady: false, baseBuild: BASE_BUILD, error: 'Netlify Blobs context is missing. Confirm this function is deployed on the Netlify site.' });
      const act = await bget(c, 'active');
      return J(200, Object.assign({ ok: true, service: 'release', storageReady: true, baseBuild: BASE_BUILD, active: act ? { id: act.id, build: +act.build, label: act.label || '' } : null, activeServed: !!(act && +act.build > BASE_BUILD), checkedAt: now }, mailConfiguration()));
    }
    if (!c) return method === 'GET' ? page(503, 'Not available', '<h1>Not available</h1><p>Storage is not available right now.</p>') : J(503, { ok: false, error: 'Netlify storage is not available to this function yet.' });

    // ---- approval page (shows details only; a button press is needed to approve) ----
    if (method === 'GET' && q.m === 'approve') {
      const p = await bget(c, 'pending'), t = String(q.t || '');
      if (!p || !/^[a-f0-9]{64}$/.test(t) || !crypto.timingSafeEqual(Buffer.from(sha(t)), Buffer.from(p.tokHash)) || now > p.exp) return page(403, 'Link not valid', '<h1>This link is not valid</h1><p>It may have expired (links last 30 minutes), already been used, or been replaced by a newer upload. Nothing was published.</p>');
      return page(200, 'Approve site update', `<h1>Approve this site update?</h1><p>Someone signed in with the developer password and uploaded a new front-end HTML version of the app. It will go live for every visitor only if you approve it.</p><table><tr><td>Label</td><td>${esc(p.label || '(none)')}</td></tr><tr><td>Build number</td><td>${p.build}</td></tr><tr><td>Uploaded</td><td>${esc(when(p.ts))}</td></tr><tr><td>From IP</td><td>${esc(p.ip)}</td></tr><tr><td>Files</td><td>${p.files.map(f => esc(f.p) + ' (' + Math.round(f.n / 1024) + ' KB)').join('<br>')}</td></tr><tr><td>App fingerprint</td><td><code>${esc(p.hash.slice(0, 32))}</code></td></tr><tr><td>Expires</td><td>${esc(when(p.exp))}</td></tr></table><div class="warn">If you did not upload this, press Reject and change your developer password.</div><form method="POST" action="/api/release"><input type="hidden" name="m" value="decide"><input type="hidden" name="t" value="${esc(t)}"><button class="ok" name="d" value="approve">Approve and publish</button><button class="no" name="d" value="reject">Reject</button></form>`);
    }
    if (method !== 'POST') return J(405, { ok: false });

    // ---- the approval button ----
    const ctype = String((e.headers || {})['content-type'] || '');
    if (/application\/x-www-form-urlencoded/i.test(ctype)) {
      const f = Object.fromEntries(new URLSearchParams(e.isBase64Encoded ? Buffer.from(e.body || '', 'base64').toString() : e.body || ''));
      const h = (mem.hits['d' + ip] = (mem.hits['d' + ip] || []).filter(x => now - x < 600e3)); if (h.length >= 10) return page(429, 'Too many attempts', '<h1>Too many attempts</h1><p>Try again later.</p>'); h.push(now);
      const p = await bget(c, 'pending'), t = String(f.t || '');
      if (f.m !== 'decide' || !p || !/^[a-f0-9]{64}$/.test(t) || !crypto.timingSafeEqual(Buffer.from(sha(t)), Buffer.from(p.tokHash)) || now > p.exp) return page(403, 'Link not valid', '<h1>This link is not valid</h1><p>It expired, was already used, or was replaced. Nothing was published.</p>');
      if (f.d !== 'approve') { await bdel(c, 'pending'); await delFiles(c, p); return page(200, 'Rejected', '<h1>Rejected</h1><p>The update was discarded. Nothing was published.</p>'); }
      const rel = { id: p.id, label: p.label, build: p.build, uploaded: p.ts, approved: now, hash: p.hash, files: p.files };
      // Keep the pending record until activation is verified. A transient storage error must not consume the approval link.
      await activate(c, rel, await bget(c, 'active'));
      await bdel(c, 'pending');
      return page(200, 'Published', `<h1>Published</h1><p>Build ${p.build} is now live. The site loader can serve it immediately; visitors may need to refresh once.</p><p>If something looks wrong, open the site with <code>?builtin=1</code> to use the built-in version, then use Developer access to roll back or delete the release.</p>`);
    }

    // ---- developer actions (need the developer token) ----
    let b = {}; try { b = JSON.parse(e.body || '{}'); } catch { return J(400, { ok: false }); }
    if (!tokenOk(e.headers)) return J(401, { ok: false, error: 'Please log in again.' });
    const mailConfig = mailConfiguration(), mailReady = mailConfig.mailReady;

    if (b.action === 'status') {
      const act = await bget(c, 'active'), p = await bget(c, 'pending'), hist = (await bget(c, 'hist')) || [];
      const pub = r => r && { id: r.id, label: r.label, build: +r.build, approved: r.approved, uploaded: r.uploaded };
      const floor = Math.max(BASE_BUILD, act ? +act.build || 0 : 0);
      return J(200, Object.assign({ ok: true, storageReady: true, baseBuild: BASE_BUILD, nextBuild: floor + 1, activeServed: !!(act && +act.build > BASE_BUILD), active: pub(act), pending: p && now <= p.exp ? { id: p.id, label: p.label, build: p.build, ts: p.ts, exp: p.exp } : null, hist: hist.map(pub) }, mailConfig));
    }
    if (b.action === 'test-email') {
      const testHits = (mem.hits['mail-test-' + ip] = (mem.hits['mail-test-' + ip] || []).filter(x => now - x < 10 * 60e3));
      if (testHits.length >= 2) return J(429, { ok: false, error: 'Email test limit reached. Try again in ten minutes.' });
      if (!mailReady) return J(503, { ok: false, error: mailConfig.mailSetupHint });
      testHits.push(now);
      const sent = await mailOwner('Arcade Tracker · email approval test', '<p>This is a test from Arcade Journey Tracker.</p><p>Your hot-update approval emails are being sent through this configured Resend account.</p><p>No application update was uploaded or published by this test.</p>', 'This is a test from Arcade Journey Tracker. No application update was uploaded or published by this test.');
      if (!sent.ok) return J(502, { ok: false, error: sent.why === 'sender_not_authorized' ? 'Resend rejected the sender. Verify the sending domain in Resend and set MAIL_FROM in Netlify.' : 'Resend could not send the test email. Check Resend Logs and Netlify function logs.', providerStatus: sent.status || null, senderHint: mailConfig.mailSetupHint });
      return J(200, { ok: true, message: 'Resend accepted the test email for delivery to OWNER_EMAIL. Check your inbox and spam folder.', mailMode: mailConfig.mailMode, mailSenderReady: mailConfig.mailSenderReady });
    }
    if (b.action === 'cancel') { const p = await bget(c, 'pending'); if (p) { await delFiles(c, p); await bdel(c, 'pending'); } return J(200, { ok: true }); }
    if (b.action === 'disable') { const act = await bget(c, 'active'); if (act) { const hist = (await bget(c, 'hist')) || []; const keep = [act, ...hist.filter(x => x.id !== act.id)].slice(0, KEEP_HIST); await bset(c, 'hist', keep); await bdel(c, 'active'); } return J(200, { ok: true }); }
    if (b.action === 'activate') {
      const hist = (await bget(c, 'hist')) || [], r = hist.find(x => x.id === b.id);
      if (!r) return J(404, { ok: false, error: 'That version is no longer stored.' });
      if (+r.build <= BASE_BUILD) return J(400, { ok: false, error: `Build ${r.build} is older than the built-in version ${BASE_BUILD} and cannot be activated.` });
      const act = await bget(c, 'active'); await activate(c, Object.assign({}, r, { approved: now }), act);
      return J(200, { ok: true });
    }
    if (b.action === 'delete') {
      const id = String(b.id || '').slice(0, 80); if (!id) return J(400, { ok: false, error: 'Choose a release to delete.' });
      const act = await bget(c, 'active'), hist = (await bget(c, 'hist')) || [];
      if (act && act.id === id) { await bdel(c, 'active'); await bset(c, 'hist', hist.filter(x => x.id !== id)); await delFiles(c, act); return J(200, { ok: true, deleted: 'active', fallback: 'builtin' }); }
      const r = hist.find(x => x.id === id); if (!r) return J(404, { ok: false, error: 'That release was not found. Refresh the list and try again.' });
      await bset(c, 'hist', hist.filter(x => x.id !== id)); await delFiles(c, r);
      return J(200, { ok: true, deleted: 'history' });
    }
    if (b.action === 'upload') {
      if (!mailReady) return J(503, { ok: false, error: mailConfig.mailSetupHint });
      const lim = ((await bget(c, 'lim')) || []).filter(t => now - t < 3600e3);
      if (lim.length >= 5) return J(429, { ok: false, error: 'Too many uploads this hour. Try again later.' });
      let files, build, hashInput;
      try {
        if (typeof b.html === 'string' && b.html) {
          const raw = Buffer.from(b.html, 'utf8');
          if (raw.length > MAX_HTML) throw new Error('The extracted app page is larger than 1.5 MB. A hot update only replaces the front-end HTML; use a normal Netlify deploy for large app changes, assets or functions.');
          build = checkApp(b.html); files = [{ p: 'app.html', data: raw }]; hashInput = raw;
        } else {
          const buf = Buffer.from(String(b.zip || ''), 'base64');
          files = parseZip(buf);
          const app = files.find(f => f.p === 'app.html');
          if (!app) throw new Error('The ZIP must contain app.html. For a full project ZIP, choose the file in Developer Mode; it will extract app-builtin.html automatically.');
          build = checkApp(app.data.toString('utf8')); hashInput = buf;
        }
      } catch (err) { return J(400, { ok: false, error: err.message }); }
      const act = await bget(c, 'active');
      const minimum = Math.max(BASE_BUILD, act ? +act.build || 0 : 0);
      if (build <= minimum) return J(400, { ok: false, error: `Build ${build} is too old. The built-in app is build ${BASE_BUILD}${act ? ` and the current stored release is build ${act.build}` : ''}. Choose build ${minimum + 1} or higher.` });
      const old = await bget(c, 'pending'); if (old) { await delFiles(c, old); }
      const id = now.toString(36) + crypto.randomBytes(3).toString('hex'), token = crypto.randomBytes(32).toString('hex'), meta = [];
      for (let i = 0; i < files.length; i++) { const ext = files[i].p.split('.').pop().toLowerCase(); await bset(c, `f-${id}-${i}`, { ct: EXT[ext], b64: files[i].data.toString('base64') }); meta.push({ p: files[i].p, n: files[i].data.length, i }); }
      const label = String(b.label || '').trim().slice(0, 60), pend = { id, label, build, ts: now, exp: now + PENDING_MS, ip, hash: sha(hashInput), files: meta, tokHash: sha(token) };
      // Persist pending metadata BEFORE sending mail so an owner who opens the
      // email immediately cannot race the pending-record write.
      await bset(c, 'pending', pend);
      const link = `${baseUrl(e)}/api/release?m=approve&t=${token}`;
      const html = `<div style="font-family:system-ui,sans-serif;max-width:520px"><h2>Approve a site update?</h2><p>The developer panel just uploaded a new version of the Arcade Tracker (<b>${esc(label || 'no label')}</b>, build ${build}). It goes live only if you approve it.</p><p><a href="${link}" style="display:inline-block;background:#e8710a;color:#fff;padding:12px 18px;border-radius:12px;text-decoration:none;font-weight:700">Review and approve</a></p><p style="font-size:13px;color:#555">Uploaded ${esc(when(now))} from IP ${esc(ip)}. The link works once and expires in 30 minutes. If this was not you, ignore this email (nothing will be published) and change your developer password.</p></div>`;
      const text = `Approve a site update? Label: ${label || 'none'}, build ${build}. Review and approve: ${link}\nUploaded ${when(now)} from IP ${ip}. The link works once and expires in 30 minutes. If this was not you, ignore this email and change your developer password.`;
      const sent = await mailOwner('Approve a site update for Arcade Tracker', html, text);
      if (!sent.ok) {
        await bdel(c, 'pending');
        for (const f of meta) await bdel(c, `f-${id}-${f.i}`);
        const hint = sent.why === 'sender_not_authorized' ? 'Resend rejected the sender. Verify your sending domain and set MAIL_FROM in Netlify.' : 'Check Resend Logs and Netlify function logs.';
        return J(502, { ok: false, error: 'The approval email could not be sent, so the update was discarded. Nothing was published. ' + hint, providerStatus: sent.status || null });
      }
      lim.push(now); await bset(c, 'lim', lim);
      return J(200, { ok: true, id, build, expiresMin: 30 });     // the approval link is never returned to the browser
    }
    return J(400, { ok: false, error: 'Unknown release action. Badge catalogue and keyword updates use the community service endpoint.' });
  } catch (err) { return method === 'GET' ? page(500, 'Error', '<h1>Something went wrong</h1><p>Please try again.</p>') : J(500, { ok: false, error: 'Storage problem: ' + err.message }); }
};
