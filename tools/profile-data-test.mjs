import test from 'node:test';
import assert from 'node:assert/strict';
import profileData from '../netlify/functions/profile-data.js';
const { uidForUrl, validProfileUrl, cleanSnapshot, cleanData, storeName, storeRegion } = profileData._test;
assert.equal(storeName, "arcade-profiles");
assert.equal(storeRegion, "us-east-2");
const uid = '12345678-abcd-1234-abcd-123456789abc';
const url = `https://www.skills.google/public_profiles/${uid}`;

test('profile backup accepts only the matching public Google Skills profile URL', () => {
  assert.equal(validProfileUrl(url, uid), true);
  assert.equal(validProfileUrl('https://example.com/public_profiles/' + uid, uid), false);
  assert.equal(validProfileUrl('http://www.skills.google/public_profiles/' + uid, uid), false);
  assert.equal(uidForUrl(url), uid);
});

test('profile snapshot keeps profile badges and strips unrelated fields', () => {
  const snap = cleanSnapshot({ url, name: 'Arcade Tester', league: 'Gold League', pages: 2, t: Date.now(), badges: [
    { key: 'Badge A|2026-11-01', title: 'Badge A', date: '2026-11-01', sk: true, extra: 'discard' },
    { key: 'Badge B|2026-11-02', title: 'Badge B', date: '2026-11-02', sk: null }
  ] });
  assert.equal(snap.name, 'Arcade Tester');
  assert.equal(snap.badges.length, 2);
  assert.equal(snap.badges[0].sk, true);
  assert.equal('extra' in snap.badges[0], false);
  assert.equal(cleanSnapshot({ url, badges: 'not-an-array' }), null);
});

test('profile cloud record validates manual overrides, points and settings', () => {
  const data = cleanData({
    snapshot: { url, name: 'Arcade Tester', badges: [{ key: 'A|2026-01-01', title: 'A', date: '2026-01-01', sk: null }] },
    overrides: { 'A|2026-01-01': 'game', bad: 'arbitrary' },
    learned: { 'badge stem': 'trivia', bad: 'special' },
    manualPoints: { [uid]: [{ id: 'a1', event: 'Manual event', points: 2.5, date: '2026-11-01' }, { event: 'bad', points: -1, date: 'bad' }] },
    config: { fac: true, bms: true, every: 15, unexpected: true },
    goal: 'Champion', customGoal: 180, gameKeywords: ['Arcade event'], skillKeywords: ['Cloud badge'], seasonYear: 2026
  }, uid);
  assert.equal(data.snapshot.url, url);
  assert.deepEqual(data.overrides, { 'A|2026-01-01': 'game' });
  assert.deepEqual(data.learned, { 'badge stem': 'trivia' });
  assert.equal(data.manualPoints[uid].length, 1);
  assert.equal(data.config.fac, true);
  assert.equal('unexpected' in data.config, false);
  assert.equal(data.goal, 'Champion');
  assert.equal(data.customGoal, 180);
  assert.equal(data.seasonYear, 2026);
});

test('profile cloud record rejects snapshots attached to another profile ID', () => {
  assert.throws(() => cleanData({ snapshot: { url, badges: [{ title: 'A' }] } }, 'another-profile-id'), /does not match/);
});

test('profile backup handler persists, reads, and deletes a record through the Blobs context', async () => {
  const oldFetch = global.fetch;
  const oldContext = process.env.NETLIFY_BLOBS_CONTEXT;
  const base = 'https://blobs.example.test';
  process.env.NETLIFY_BLOBS_CONTEXT = Buffer.from(JSON.stringify({ url: base, token: 'unit-test-token' })).toString('base64');
  const records = new Map();
  global.fetch = async (input, options = {}) => {
    const key = new URL(String(input)).pathname.split('/').slice(-1)[0];
    if (options.method === 'PUT') {
      records.set(key, String(options.body));
      return { ok: true, status: 200, text: async () => '' };
    }
    if (options.method === 'DELETE') {
      records.delete(key);
      return { ok: true, status: 200, text: async () => '' };
    }
    if (records.has(key)) return { ok: true, status: 200, text: async () => records.get(key) };
    return { ok: false, status: 404, text: async () => '' };
  };
  const headers = { host: 'arcade.example.netlify.app', origin: 'https://arcade.example.netlify.app', 'x-nf-site-id': 'site-test', 'x-nf-client-connection-ip': 'profile-handler-test' };
  const snapshot = { url, name: 'Arcade Tester', badges: [{ key: 'A|2026-01-01', title: 'A', date: '2026-01-01', sk: true }] };
  try {
    const saved = await profileData.handler({ httpMethod: 'POST', headers, body: JSON.stringify({ action: 'save', uid, data: { snapshot, overrides: { 'A|2026-01-01': 'skill' } } }) });
    assert.equal(saved.statusCode, 200);
    assert.equal(JSON.parse(saved.body).ok, true);
    const loaded = await profileData.handler({ httpMethod: 'GET', headers, queryStringParameters: { uid } });
    const payload = JSON.parse(loaded.body);
    assert.equal(loaded.statusCode, 200);
    assert.equal(payload.exists, true);
    assert.equal(payload.data.snapshot.badges[0].title, 'A');
    assert.deepEqual(payload.data.overrides, { 'A|2026-01-01': 'skill' });
    const removed = await profileData.handler({ httpMethod: 'POST', headers, body: JSON.stringify({ action: 'delete', uid }) });
    assert.equal(removed.statusCode, 200);
    assert.equal(records.size, 0);
    const blocked = await profileData.handler({ httpMethod: 'GET', headers: { ...headers, origin: 'https://other.example' }, queryStringParameters: { uid } });
    assert.equal(blocked.statusCode, 403);
  } finally {
    global.fetch = oldFetch;
    if (oldContext === undefined) delete process.env.NETLIFY_BLOBS_CONTEXT;
    else process.env.NETLIFY_BLOBS_CONTEXT = oldContext;
  }
});
