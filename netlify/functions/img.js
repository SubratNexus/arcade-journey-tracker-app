// Badge picture proxy for the picture scanner: https only, Google Skills image hosts only,
// redirects re-checked, 6s timeout, 1.5MB max, images only, 300 calls/min per IP.
const SUF = ['skills.google', 'cloudskillsboost.google', 'qwiklabs.com', 'googleusercontent.com', 'gstatic.com'];
const hits = new Map();
const okHost = h => SUF.some(s => h === s || h.endsWith('.' + s));
const R = (c, b) => ({ statusCode: c, headers: { 'content-type': 'text/plain' }, body: b });

exports.handler = async e => {
  const ip = e.headers['x-nf-client-connection-ip'] || 'x', now = Date.now();
  const a = (hits.get(ip) || []).filter(t => now - t < 6e4);
  if (a.length >= 300) return R(429, 'rate');
  a.push(now); hits.set(ip, a);
  let cur;
  try { cur = new URL((e.queryStringParameters || {}).u); } catch { return R(400, 'invalid'); }
  try {
    for (let i = 0; i < 4; i++) {
      if (cur.protocol !== 'https:' || cur.username || cur.port || !okHost(cur.hostname)) return R(400, 'invalid');
      const ac = new AbortController(), to = setTimeout(() => ac.abort(), 6000);
      let r;
      try { r = await fetch(cur, { redirect: 'manual', signal: ac.signal, headers: { 'user-agent': 'Mozilla/5.0', accept: 'image/*' } }); } finally { clearTimeout(to); }
      if (r.status >= 300 && r.status < 400) { cur = new URL(r.headers.get('location'), cur); continue; }
      if (!r.ok) return R(502, 'unavailable');
      const ct = r.headers.get('content-type') || '';
      if (!/^image\//.test(ct)) return R(415, 'type');
      const b = Buffer.from(await r.arrayBuffer());
      if (b.length > 1.5e6) return R(413, 'big');
      return { statusCode: 200, isBase64Encoded: true, body: b.toString('base64'), headers: { 'content-type': ct, 'cache-control': 'public, max-age=86400', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox" } };
    }
    return R(502, 'redirects');
  } catch { return R(502, 'unavailable'); }
};
