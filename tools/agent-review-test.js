'use strict';
const assert = require('assert');
const crypto = require('crypto');
const api = require('../netlify/functions/agent-review.js');
const t = api._test;

(async () => {
  const originalFetch = global.fetch;
  const oldSecret = process.env.AGENT_REVIEW_SECRET;
  const oldToken = process.env.AGENT_GITHUB_TOKEN;
  const secret = 'test-review-secret-that-is-at-least-32-characters-long';
  const itemId = '0123456789abcdef01234567';
  const ts = String(Math.floor(Date.now() / 1000));
  const action = 'approve';
  const sig = crypto.createHmac('sha256', secret).update(`${itemId}.${action}.${ts}`).digest('hex');
  const linkData = { item_id: itemId, action, ts, sig };
  const item = {
    item_id: itemId, status: 'pending', title: 'Approved source proposal',
    entity_type: 'programme_event', change_type: 'add', detected_at: '2026-11-27T00:00:00Z',
    record: { evidence: 'A test evidence note', source_url: 'https://discuss.google.dev/t/arcade/123' }
  };
  const queue = { schema_version: 1, items: [item] };
  const persisted = new Map();
  let dispatchCount = 0;
  t.setStoreProviderForTests(() => ({
    async setJSON(key, value, options = {}) {
      if (options.onlyIfNew && persisted.has(key)) return { modified: false };
      persisted.set(key, value);
      return { modified: true };
    },
    async delete(key) { persisted.delete(key); }
  }));
  process.env.AGENT_REVIEW_SECRET = secret;
  process.env.AGENT_GITHUB_TOKEN = 'fake-github-token-for-tests';
  global.fetch = async (url, init = {}) => {
    if (String(url).includes('/review-queue.json')) {
      return { ok: true, status: 200, text: async () => JSON.stringify(queue) };
    }
    if (String(url).includes('/dispatches')) {
      dispatchCount++;
      const payload = JSON.parse(init.body);
      assert.strictEqual(payload.inputs.item_id, itemId);
      assert.strictEqual(payload.inputs.decision, action);
      return { ok: true, status: 204 };
    }
    throw new Error('Unexpected fetch URL: ' + String(url));
  };

  try {
    assert.strictEqual(t.verifySignature(linkData, Number(ts), secret).ok, true);
    assert.strictEqual(t.verifySignature({ ...linkData, sig: 'f'.repeat(64) }, Number(ts), secret).ok, false);
    assert.strictEqual(t.verifySignature(linkData, Number(ts) + 8 * 24 * 60 * 60, secret).ok, false);
    assert.strictEqual(t.findPendingItem(queue, itemId), item);
    assert.strictEqual(t.findPendingItem({ items: [{ ...item, status: 'approved' }] }, itemId), null);

    const getResponse = await api.handler({
      httpMethod: 'GET', queryStringParameters: linkData,
      headers: { 'x-nf-client-connection-ip': 'agent-review-get-test' }
    });
    assert.strictEqual(getResponse.statusCode, 200);
    assert.match(getResponse.body, /Confirm Approval/);
    assert.match(getResponse.body, /Opening this page does not submit a decision/);
    assert.strictEqual(dispatchCount, 0, 'GET must never dispatch a review decision');
    assert.strictEqual(persisted.size, 0, 'GET must not mark a signed review token as used');

    const body = new URLSearchParams({ ...linkData, confirm: '1' }).toString();
    const postEvent = {
      httpMethod: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://tracker.example', host: 'tracker.example',
        'x-nf-client-connection-ip': 'agent-review-post-test'
      },
      body
    };
    const postResponse = await api.handler(postEvent);
    assert.strictEqual(postResponse.statusCode, 200);
    assert.match(postResponse.body, /Approval submitted/);
    assert.strictEqual(dispatchCount, 1);
    assert.strictEqual(persisted.size, 1, 'POST must persistently reserve the signed review token');

    const duplicateResponse = await api.handler(postEvent);
    assert.strictEqual(duplicateResponse.statusCode, 409);
    assert.match(duplicateResponse.body, /already used/i);
    assert.strictEqual(dispatchCount, 1, 'a repeated click must not dispatch twice');
  } finally {
    global.fetch = originalFetch;
    t.resetForTests();
    if (oldSecret === undefined) delete process.env.AGENT_REVIEW_SECRET; else process.env.AGENT_REVIEW_SECRET = oldSecret;
    if (oldToken === undefined) delete process.env.AGENT_GITHUB_TOKEN; else process.env.AGENT_GITHUB_TOKEN = oldToken;
  }
  console.log('Arcade Intelligence per-item review tests passed: signed links, scanner-safe GET, explicit POST, durable replay guard, and one-item dispatch.');
})().catch(error => { console.error(error); process.exitCode = 1; });
