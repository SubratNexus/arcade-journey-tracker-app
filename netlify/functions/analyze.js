// Secure multi-page profile fetcher: https only, Google Skills allowlist, redirects re-checked,
// 6s per request, 2MB per page, 10 calls/min per IP, 20s cache, reads available badge pages in parallel batches (up to 41 pages per refresh).
const HOSTS = ['skills.google', 'www.skills.google', 'cloudskillsboost.google', 'www.cloudskillsboost.google'];
const cache = new Map(), hits = new Map();
const H = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', 'accept-language': 'en-US,en;q=0.9', accept: 'text/html' };
const J = (c, o) => ({ statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) });
const ok = x => x.protocol === 'https:' && !x.username && !x.port && HOSTS.includes(x.hostname) && x.pathname.startsWith('/public_profiles/');
const TITLE = /<span\b[^>]*class=['"][^'"]*\bql-title-medium\b[^'"]*['"][^>]*>([\s\S]*?)<\/span>/gi;
const titles = h => [...h.matchAll(TITLE)].map(m => m[1].replace(/<[^>]+>/g, '').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").trim()).filter(Boolean);
const slim = h => h.replace(/<(script|style|svg|noscript)[\s\S]*?<\/\1>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
const pg = (u, n) => { const x = new URL(u.href); x.searchParams.set('page', n); return x; };

async function one(u) {
  let cur = u;
  for (let i = 0; i < 3; i++) {
    const ac = new AbortController(), to = setTimeout(() => ac.abort(), 4500);
    let r;
    try { r = await fetch(cur, { redirect: 'manual', signal: ac.signal, headers: H }); } finally { clearTimeout(to); }
    if (r.status >= 300 && r.status < 400) {
      cur = new URL(r.headers.get('location'), cur);
      if (!ok(cur)) throw new Error('redirect');
      continue;
    }
    if (!r.ok) throw Object.assign(new Error('http'), { status: r.status });
    const b = Buffer.from(await r.arrayBuffer());
    if (b.length > 2e6) throw new Error('big');
    return b.toString('utf8');
  }
  throw new Error('redirects');
}

async function oneRetry(u) {          // Google sometimes answers slowly or with a hiccup: try again once
  try { return await one(u); } catch (err) {
    if (err.status === 404) throw err;
    await new Promise(r => setTimeout(r, 400));
    return await one(u);
  }
}

exports.handler = async e => {
  const q = e.queryStringParameters || {}, ip = e.headers['x-nf-client-connection-ip'] || 'x', now = Date.now();
  const a = (hits.get(ip) || []).filter(t => now - t < 6e4);
  if (a.length >= 10) return J(429, { error: 'rate' });
  a.push(now); hits.set(ip, a);
  let u;
  try { u = new URL(q.url); } catch { return J(400, { error: 'invalid' }); }
  u.search = '';
  if (!ok(u)) return J(400, { error: 'invalid' });
  const c = cache.get(u.href);
  if (c && now - c.t < 2e4 && !q.fresh) return J(200, { pages: c.p, fetchedAt: c.t, cached: true });
  try {
    const first = slim(await oneRetry(u)), pages = [first], seen = new Set(titles(first));
    let done = false, partial = false, failed = false;
    for (let n = 2; n <= 41 && !done && Date.now() - now < 7000; n += 4) {
      const batch = await Promise.all([0, 1, 2, 3].map(k => oneRetry(pg(u, n + k)).then(slim).catch(e => (e && e.status === 404 ? '' : null))));
      let emptyInBatch = 0;
      for (const h of batch) {
        if (h === null) { failed = true; continue; }   // a failed page is skipped; it does not end the scan
        const t = titles(h);
        if (!t.length || t.every(x => seen.has(x))) { emptyInBatch++; continue; }
        emptyInBatch = 0; t.forEach(x => seen.add(x)); pages.push(h);
      }
      if (emptyInBatch >= 2) done = true;
    }
    partial = failed || (!done && Date.now() - now >= 7000);
    if (!partial) { cache.set(u.href, { p: pages, t: now }); if (cache.size > 200) cache.delete(cache.keys().next().value); }
    return J(200, partial ? { pages, fetchedAt: now, partial: true } : { pages, fetchedAt: now });
  } catch (err) {
    const old = cache.get(u.href);        // Google is being difficult: serve the last good copy instead of an error
    if (old) return J(200, { pages: old.p, fetchedAt: old.t, cached: true, stale: true });
    return J(err.status === 429 ? 429 : 502, { error: 'unavailable' });
  }
};
