import test from 'node:test';
import assert from 'node:assert/strict';
import { _test as helpers } from '../netlify/functions/profile-data.mjs';
const { uidForUrl, validProfileUrl, cleanSnapshot, cleanData, accountPrefix } = helpers;
const uid = '12345678-abcd-1234-abcd-123456789abc';
const url = `https://www.skills.google/public_profiles/${uid}`;

test('profile backup accepts only the matching public Google Skills profile URL', () => {
  assert.equal(validProfileUrl(url, uid), true);
  assert.equal(validProfileUrl('https://example.com/public_profiles/' + uid, uid), false);
  assert.equal(validProfileUrl('http://www.skills.google/public_profiles/' + uid, uid), false);
  assert.equal(uidForUrl(url), uid);
});

test('profile snapshot keeps badge data and strips unrelated fields', () => {
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

test('private cloud record keeps manual overrides, bonus points, profiles and settings', () => {
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

test('profile backups are scoped by authenticated account as well as Google profile ID', () => {
  const first = accountPrefix('identity-user-a');
  const second = accountPrefix('identity-user-b');
  assert.notEqual(first, second);
  assert.match(first, /^u-[a-f0-9]{40}$/);
  assert.throws(() => cleanData({ snapshot: { url, badges: [{ title: 'A' }] } }, 'another-profile-id'), /does not match/);
});
