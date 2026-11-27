'use strict';

// Secure per-item review endpoint for Arcade Intelligence.
// GET displays a confirmation page only. POST explicitly dispatches exactly
// one approve/reject decision to the agent repository's review workflow.
// This function is intentionally separate from /api/release (Hot Updates).

const crypto = require('crypto');

const QUEUE_URL = 'https://raw.githubusercontent.com/SubratNexus/arcade-intelligence-2.0/main/agent-data/review-queue.json';
const DISPATCH_URL = 'https://api.github.com/repos/SubratNexus/arcade-intelligence-2.0/actions/workflows/arcade-review-apply.yml/dispatches';
const MAX_BODY_BYTES = 8 * 1024;
const MAX_QUEUE_BYTES = 2 * 1024 * 1024;
const MAX_LINK_AGE_SECONDS = 7 * 24 * 60 * 60;
const FUTURE_CLOCK_SKEW_SECONDS = 5 * 60;
const memory = { hits: Object.create(null) };

const HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store, max-age=0',
  'pragma': 'no-cache',
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex, nofollow',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
};

function headersOf(event) {
  const input = event && event.headers && typeof event.headers === 'object' ? event.headers : {};
  const output = {};
  for (const [key, value] of Object.entries(input)) output[String(key).toLowerCase()] = String(value || '');
  return output;
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function htmlPage(statusCode, title, message, extra = '') {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(title)}</title><style>
    *{box-sizing:border-box}body{margin:0;min-height:100vh;padding:18px;display:grid;place-items:center;background:#0b1020;color:#e9efff;font:16px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}
    main{width:min(100%,560px);padding:24px;border:1px solid #2b385e;border-radius:20px;background:#131d38;box-shadow:0 18px 60px #0005}h1{font-size:23px;line-height:1.25;margin:0 0 12px}p{color:#c7d2eb}dl{display:grid;grid-template-columns:110px 1fr;gap:8px 12px;font-size:14px}dt{color:#94a3c7}dd{margin:0;overflow-wrap:anywhere}.notice{padding:12px;border:1px solid #8b692a;border-radius:12px;background:#332a17;color:#ffe1a0;font-size:14px;margin:16px 0}button{width:100%;border:0;border-radius:12px;padding:14px;margin-top:10px;font:700 16px system-ui;cursor:pointer}.approve{background:#2fc47b;color:#062516}.reject{background:#d94b5a;color:#fff}.secondary{background:#2a385d;color:#fff}a{color:#9bc6ff;overflow-wrap:anywhere}
    </style></head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>${extra}</main></body></html>`;
  return { statusCode, headers: HEADERS, body };
}

function validActionData(data) {
  const itemId = String(data.item_id || '');
  const action = String(data.action || '');
  const timestamp = String(data.ts || '');
  const signature = String(data.sig || '');
  if (!/^[a-f0-9]{24}$/.test(itemId)) return null;
  if (action !== 'approve' && action !== 'reject') return null;
  if (!/^\d{10}$/.test(timestamp)) return null;
  if (!/^[a-f0-9]{64}$/.test(signature)) return null;
  return { itemId, action, timestamp, signature };
}

function verifySignature(data, nowSeconds = Math.floor(Date.now() / 1000)) {
  const secret = String(process.env.AGENT_REVIEW_SECRET || '');
  if (secret.length < 32) return { ok: false, reason: 'Review signing is not configured.' };
  const parsed = validActionData(data);
  if (!parsed) return { ok: false, reason: 'This review link is incomplete or malformed.' };
  const issuedAt = Number(parsed.timestamp);
  if (issuedAt > nowSeconds + FUTURE_CLOCK_SKEW_SECONDS || nowSeconds - issuedAt > MAX_LINK_AGE_SECONDS) {
    return { ok: false, reason: 'This review link has expired. Wait for the next owner review email.' };
  }
  const message = `${parsed.itemId}.${parsed.action}.${parsed.timestamp}`;
  const expected = crypto.createHmac('sha256', secret).update(message, 'utf8').digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(parsed.signature, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'This review link could not be authenticated.' };
  }
  return { ok: true, ...parsed };
}

function rateAllowed(ip, limit = 12, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const recent = (memory.hits[ip] || []).filter(time => now - time < windowMs);
  if (recent.length >= limit) {
    memory.hits[ip] = recent;
    return false;
  }
  recent.push(now);
  memory.hits[ip] = recent;
  return true;
}

async function fetchReviewQueue() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6500);
  try {
    const response = await fetch(QUEUE_URL, {
      method: 'GET',
      redirect: 'error',
      cache: 'no-store',
      signal: controller.signal,
      headers: { accept: 'application/json', 'cache-control': 'no-cache', 'user-agent': 'ArcadeTracker-OwnerReview/1.0' }
    });
    if (!response.ok) throw new Error(`Review queue is unavailable (HTTP ${response.status}).`);
    const raw = await response.text();
    if (Buffer.byteLength(raw, 'utf8') > MAX_QUEUE_BYTES) throw new Error('Review queue exceeded its safety size limit.');
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.items)) throw new Error('Review queue format is not supported.');
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function findPendingItem(queue, itemId) {
  return queue.items.find(item => item && item.item_id === itemId && item.status === 'pending') || null;
}

function safeSourceUrl(item) {
  const record = item && item.record && typeof item.record === 'object' ? item.record : {};
  const candidates = [item && item.source_url, record.source_url, record.badge_url,
    ...(Array.isArray(record.source_urls) ? record.source_urls : [])];
  for (const candidate of candidates) {
    try {
      const url = new URL(String(candidate || ''));
      if (url.protocol === 'https:' && !url.username && !url.password && !url.port) return url.href;
    } catch { /* Ignore malformed source references. */ }
  }
  return '';
}

function reviewForm(data, item) {
  const decision = data.action;
  const actionTitle = decision === 'approve' ? 'Approve this update?' : 'Reject this update?';
  const sourceUrl = safeSourceUrl(item);
  const record = item.record && typeof item.record === 'object' ? item.record : {};
  const evidence = record.evidence || record.verification_explanation || 'No evidence note was supplied.';
  const details = `<dl>
    <dt>Update</dt><dd>${escapeHtml(item.title || 'Untitled update')}</dd>
    <dt>Category</dt><dd>${escapeHtml(String(item.entity_type || 'update').replace(/_/g, ' '))}</dd>
    <dt>Change</dt><dd>${escapeHtml(item.change_type || 'update')}</dd>
    <dt>Evidence</dt><dd>${escapeHtml(evidence)}</dd>
    <dt>Detected</dt><dd>${escapeHtml(item.detected_at || 'Not available')}</dd>
    <dt>Review ID</dt><dd>${escapeHtml(item.item_id)}</dd>
    ${sourceUrl ? `<dt>Original source</dt><dd><a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">Open source</a></dd>` : ''}
  </dl>
  <div class="notice">This action applies to this one update only. No other pending update will be approved or rejected. The app's Hot Update approval system is separate and will not be changed.</div>
  <form method="post" action="/api/agent-review">
    <input type="hidden" name="item_id" value="${escapeHtml(data.itemId)}">
    <input type="hidden" name="action" value="${escapeHtml(data.action)}">
    <input type="hidden" name="ts" value="${escapeHtml(data.timestamp)}">
    <input type="hidden" name="sig" value="${escapeHtml(data.signature)}">
    <input type="hidden" name="confirm" value="1">
    <button class="${decision === 'approve' ? 'approve' : 'reject'}" type="submit">Confirm ${decision === 'approve' ? 'Approval' : 'Rejection'}</button>
  </form>
  <p style="font-size:12px;color:#94a3c7">Opening this page does not submit a decision. You must press the confirmation button above.</p>`;
  return htmlPage(200, actionTitle, 'Review the details and source. The decision will be sent to the Arcade Intelligence review workflow only after you confirm.', details);
}

function requestOriginAllowed(headers) {
  const origin = headers.origin;
  if (!origin) return true;
  const forwardedHost = headers['x-forwarded-host'] || headers.host || '';
  const host = String(forwardedHost).split(',')[0].trim();
  if (!host) return false;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'https:' && parsed.host.toLowerCase() === host.toLowerCase();
  } catch { return false; }
}

async function dispatchDecision(itemId, decision) {
  const token = String(process.env.AGENT_GITHUB_TOKEN || '').trim();
  if (!token) throw new Error('GitHub workflow access is not configured on the Netlify site.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(DISPATCH_URL, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'ArcadeJourneyTracker-OwnerReview/1.0'
      },
      body: JSON.stringify({ ref: 'main', inputs: { item_id: itemId, decision } })
    });
    if (!response.ok) {
      // Never return provider response bodies, which may contain internal details.
      throw new Error(`GitHub did not accept the review action (HTTP ${response.status}). Check the repository-scoped token and Actions write permission.`);
    }
    return true;
  } finally {
    clearTimeout(timer);
  }
}

exports.handler = async event => {
  const method = String(event && event.httpMethod || 'GET').toUpperCase();
  const headers = headersOf(event);
  const ip = headers['x-nf-client-connection-ip'] || 'unknown';
  if (!rateAllowed(ip)) return htmlPage(429, 'Too many review requests', 'Please wait a few minutes and try again.');

  if (method === 'GET') {
    const data = verifySignature(event.queryStringParameters || {});
    if (!data.ok) return htmlPage(403, 'Review link not valid', data.reason);
    try {
      const queue = await fetchReviewQueue();
      const item = findPendingItem(queue, data.itemId);
      if (!item) return htmlPage(409, 'This update is no longer pending', 'It may already have a final decision, or the review item may have been replaced. No new action was submitted.');
      return reviewForm(data, item);
    } catch (error) {
      return htmlPage(503, 'Review service temporarily unavailable', error.message || 'The review queue could not be checked. Please try again later.');
    }
  }

  if (method !== 'POST') {
    return { statusCode: 405, headers: { ...HEADERS, allow: 'GET, POST' }, body: 'Method not allowed.' };
  }
  if (!requestOriginAllowed(headers)) return htmlPage(403, 'Request not accepted', 'The confirmation must be submitted from the same Arcade Tracker site that opened this review page.');
  const contentType = headers['content-type'] || '';
  if (!/application\/x-www-form-urlencoded/i.test(contentType)) return htmlPage(415, 'Unsupported request', 'Please use the confirmation button in the review page.');
  const rawBody = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : String(event.body || '');
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) return htmlPage(413, 'Request too large', 'The confirmation request exceeded its safety limit.');
  const form = Object.fromEntries(new URLSearchParams(rawBody));
  if (form.confirm !== '1') return htmlPage(400, 'Confirmation required', 'Press the confirmation button on the review page to submit this one decision.');
  const data = verifySignature(form);
  if (!data.ok) return htmlPage(403, 'Review link not valid', data.reason);

  try {
    // Re-check the live queue immediately before dispatch. The workflow also
    // serializes decisions and refuses to overwrite a final decision.
    const queue = await fetchReviewQueue();
    if (!findPendingItem(queue, data.itemId)) {
      return htmlPage(409, 'This update already has a decision', 'The update is no longer pending. A previous decision has been applied or is being processed.');
    }
    await dispatchDecision(data.itemId, data.action);
    const label = data.action === 'approve' ? 'Approval' : 'Rejection';
    return htmlPage(200, `${label} submitted`, `Your ${data.action} decision for this one update was accepted by GitHub Actions. The review workflow will now update the approved knowledge database and the review queue. This page does not mean the workflow has already finished.`, '<p style="font-size:13px;color:#94a3c7">You can close this page. No global approval action was performed.</p>');
  } catch (error) {
    return htmlPage(502, 'Decision could not be submitted', error.message || 'The review workflow could not be reached. No decision was confirmed.');
  }
};

exports._test = { verifySignature, validActionData, findPendingItem, requestOriginAllowed, safeSourceUrl };
