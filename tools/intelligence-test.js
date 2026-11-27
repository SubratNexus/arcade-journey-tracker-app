'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const api = require('../netlify/functions/intelligence.js');
const t = api._test;
const safeTaskPlan = t.sanitiseTaskPlan({taskType:'current_news',tools:['web','intelligence','evil','https://attacker.example']});
assert.deepStrictEqual(safeTaskPlan.tools, ['web','intelligence']);
assert.strictEqual(t.safeKnowledgeUrl('https://www.skills.google/course_templates/123').startsWith('https://www.skills.google/'), true);
assert.strictEqual(t.safeKnowledgeUrl('https://attacker.example/fake'), '');
const profile = t.sanitiseProfile({
  currentPoints: 86.5,
  currentTier: 'Ranger',
  targetTier: 'Champion',
  targetPoints: 95,
  gameBadges: 12,
  skillBadges: 61,
  specialBadges: 1,
  manualPoints: 2,
  facilitatorPoints: 5,
  hoursPerWeek: 6,
  focus: 'skills',
  earnedBadgeTitles: ['Intro to Cloud', 'Intro to Cloud', '  Build APIs  '],
  availableSkillBadges: ['Kubernetes Basics'],
  profileUrl: 'https://private.example/profile/123',
  email: 'private@example.test',
  name: 'Private Name',
});
assert.strictEqual(profile.pointsRemaining, 8.5);
assert.deepStrictEqual(profile.earnedBadgeTitles, ['Intro to Cloud', 'Build APIs']);
assert.strictEqual(Object.prototype.hasOwnProperty.call(profile, 'email'), false);
assert.strictEqual(Object.prototype.hasOwnProperty.call(profile, 'profileUrl'), false);
assert.strictEqual(Object.prototype.hasOwnProperty.call(profile, 'name'), false);
assert.strictEqual(profile.focus, 'skills');

const context = t.sanitiseCalculatorContext({rules:{version:'test',year:2026,pointValues:{game:1,trivia:1,special:2,skill:0.5},tiers:[{n:'Ranger',min:75}]},totals:{counts:{games:2,skills:3},pointBreakdown:{game:2,skill:1.5}},earnedBadgeTitles:['A']},profile);
assert.strictEqual(context.totals.currentPoints, profile.currentPoints);
assert.strictEqual(context.rules.pointValues.skill, 0.5);

const requestedAdditional = t.applyQuestionGoal({ ...profile }, 'How can I achieve 20 points till the programme end?');
assert.strictEqual(requestedAdditional.targetPoints, 106.5);
assert.strictEqual(requestedAdditional.pointsRemaining, 20);
assert.match(t.fallbackPlan(requestedAdditional, { programme_events: [], youtube_videos: [] }, 'How can I achieve 20 points till the programme end?'), /20 points remain/);
assert.match(t.fallbackPlan(requestedAdditional, { programme_events: [], youtube_videos: [] }, 'How can I achieve 20 points till the programme end?'), /does not provide a structured, independently verified programme-end date/);
const requestedAbsolute = t.applyQuestionGoal({ ...profile }, 'How can I reach 120 Arcade points?');
assert.strictEqual(requestedAbsolute.targetPoints, 120);

assert.strictEqual(t.safeSourceUrl('https://discuss.google.dev/t/arcade/123').startsWith('https://discuss.google.dev/t/'), true);
assert.strictEqual(t.safeSourceUrl('https://evil.example/fake'), '');
assert.strictEqual(t.safeSourceUrl('javascript:alert(1)'), '');
assert.strictEqual(t.safeSourceUrl('https://user:pass@youtube.com/watch?v=abc'), '');

const trusted = {
  source_type: 'google_cloud_community',
  source_domain: 'discuss.google.dev',
  source_url: 'https://discuss.google.dev/t/arcade-announcement/123',
  is_google_staff_author: true,
  publisher_authority: 'google_staff_group',
  author_verification_method: 'discourse_google_staff_group',
};
const good = {
  event_id: 'approved-1',
  title: 'Arcade announcement',
  verification_status: 'officially_announced',
  human_review_required: false,
  notification_approved: true,
  sources: [trusted],
};
const pending = { ...good, event_id: 'pending-1', human_review_required: true, notification_approved: false };
const fakeStaff = { ...good, event_id: 'fake-1', sources: [{ ...trusted, author_verification_method: 'forum_moderator' }] };
assert.strictEqual(t.isTrustedOfficialSource(good), true);
assert.deepStrictEqual(t.approvedEvents({ programme_events: [good, pending, fakeStaff] }), [good]);

const fallback = t.fallbackPlan(profile, { programme_events: [pending], youtube_videos: [] }, 'Make my plan');
assert.match(fallback, /86\.5 Arcade points/);
assert.match(fallback, /8\.5 points remain/);
assert.match(fallback, /Kubernetes Basics/);
assert.match(fallback, /awaiting human review/);
assert.match(fallback, /calculator's simple estimate|calculator/i);
const targetAnswer = t.fallbackPlan(profile, { programme_events: [], youtube_videos: [] }, 'How many points do I need to reach my target?');
assert.match(targetAnswer, /about 9 counted game\/trivia badges or 17 Skill Badges/);
const skillAnswer = t.fallbackPlan(profile, { programme_events: [], youtube_videos: [] }, 'Which skill badge should I do next?');
assert.match(skillAnswer, /Kubernetes Basics/);
const newsAnswer = t.fallbackPlan(profile, { programme_events: [pending], youtube_videos: [] }, 'Any new announcements or events?');
assert.match(newsAnswer, /awaiting human review/);
assert.doesNotMatch(newsAnswer, /Your current estimate is/, 'announcement replies should not repeat personal points boilerplate');
const videoAnswer = t.fallbackPlan(profile, { programme_events: [], youtube_videos: [] }, 'Show me new YouTube videos');
assert.match(videoAnswer, /no matching videos in the public intelligence feed/);
assert.doesNotMatch(fallback, /You are guaranteed/);

const counts = Object.create(null);
assert.strictEqual(t.rateAllowed(counts, 'test-ip', 2, 60000), true);
assert.strictEqual(t.rateAllowed(counts, 'test-ip', 2, 60000), true);
assert.strictEqual(t.rateAllowed(counts, 'test-ip', 2, 60000), false);

(async () => {
  const oldFetch = global.fetch;
  try {
    let fetchCalls = [];
    global.fetch = async url => {
      const requested = String(url);
      fetchCalls.push(requested);
      if (requested.startsWith('https://raw.githubusercontent.com/SubratNexus/arcade-intelligence-2.0/')) {
        let payload;
        if (requested.endsWith('/approved-knowledge.json')) {
          payload = {
            schema_version: 1, initialization_status: 'initialized', updated_at: '2026-11-27T00:00:00Z',
            knowledge_version: 'approved-test-v1',
            items: [
              { entity_type: 'programme_event', entity_id: 'programme_event:approved-1', title: good.title,
                record: good, digest: 'event-digest', source_url: trusted.source_url,
                approved_at: '2026-11-27T00:00:00Z', approved_by: 'owner_email_review', approval_method: 'explicit_per_item_confirmation' },
              { entity_type: 'skill_badge', entity_id: 'skill_badge:kubernetes', title: 'Kubernetes Basics',
                record: { title: 'Kubernetes Basics', category: 'skill', source_url: 'https://www.skills.google/course_templates/123',
                  evidence: 'Explicit visible SKILL BADGE label', point_value: 0.5, verified: true },
                digest: 'skill-digest', source_url: 'https://www.skills.google/course_templates/123',
                approved_at: '2026-11-27T00:00:00Z', approved_by: 'owner_email_review', approval_method: 'explicit_per_item_confirmation' }
            ]
          };
        } else if (requested.endsWith('/catalogue.json')) {
          payload = {
            schema_version: 1, version: '1.1.0', status: 'ok', last_run_at: '2026-11-27T00:00:00Z',
            entries: [{title:'Kubernetes Basics', category:'skill', verified:true, status:'active', source_url:'https://www.skills.google/course_templates/123', evidence:'Explicit visible SKILL BADGE label'}],
            game_entries: [], completion_badges: [], candidates: [{title:'Unresolved badge lead', category:'unknown', source_url:'https://www.skills.google/course_templates/456', confidence:0.4, evidence:'Needs review'}],
            stats: {pages_crawled:15, verified_skill_badges:1, verified_game_badges:0, verified_completion_badges:0, pending_candidates:1, page_errors:0}
          };
        } else {
          payload = { schema_version: 1, generated_at: '2026-11-27T00:00:00Z', knowledge_version:'feed-test-1', programme_events: [pending], youtube_videos: [] };
        }
        return { ok: true, text: async () => JSON.stringify(payload) };
      }
      // Public research providers receive only the user question, never dashboard identifiers or personal profile data.
      assert.doesNotMatch(decodeURIComponent(requested), /private@example\.test|private\.example|Private Name/);
      if (requested.startsWith('https://www.bing.com/search?')) {
        if (/photosynthesis/i.test(requested)) {
          return { ok: true, text: async () => '<rss><channel><item><title>Photosynthesis: how plants make food</title><link>https://example.org/photosynthesis</link><description>Photosynthesis converts sunlight, water and carbon dioxide into sugars and oxygen.</description><pubDate>Fri, 27 Nov 2026 00:00:00 GMT</pubDate></item></channel></rss>' };
        }
        return { ok: true, text: async () => '<rss><channel><item><title>General search lead</title><link>https://example.org/search-lead</link><description>Unverified web result</description><pubDate>Fri, 27 Nov 2026 00:00:00 GMT</pubDate></item></channel></rss>' };
      }
      if (requested.startsWith('https://news.google.com/rss/search?')) {
        return { ok: true, text: async () => '<rss><channel><item><title>Google News event lead</title><link>https://news.google.com/rss/articles/sample</link><description>News discovery</description><source url="https://cloud.google.com/">Google Cloud</source><pubDate>Fri, 27 Nov 2026 00:00:00 GMT</pubDate></item></channel></rss>' };
      }
      if (requested.startsWith('https://discuss.google.dev/search.json?')) {
        return { ok: true, text: async () => JSON.stringify({ topics: [{ id: 99, slug: 'community-report', title: 'Community report about Arcade swag', excerpt: 'A community report, not official confirmation.', created_at: '2026-11-27T00:00:00Z' }] }) };
      }
      if (requested.startsWith('https://www.youtube.com/feeds/videos.xml?')) {
        return { ok: true, text: async () => '<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"><entry><yt:videoId>abcdefghijk</yt:videoId><title>Google Skills Arcade event update</title><published>2026-11-27T00:00:00Z</published><link rel="alternate" href="https://www.youtube.com/watch?v=abcdefghijk" /></entry></feed>' };
      }
      throw new Error('Unexpected research endpoint: ' + requested);
    };

    const health = await api.handler({ httpMethod: 'GET', queryStringParameters: { m: 'health' }, headers: {} });
    assert.strictEqual(health.statusCode, 200);
    const healthPayload = JSON.parse(health.body);
    assert.strictEqual(healthPayload.service, 'arcade-intelligence');
    assert.strictEqual(healthPayload.externalAi, false);
    assert.doesNotMatch(health.body, /api[_-]?key|secret|password/i);

    const event = {
      httpMethod: 'POST',
      headers: { 'x-nf-client-connection-ip': 'rule-agent-test-818' },
      body: JSON.stringify({
        action: 'plan',
        message: 'Build my personalised Arcade plan',
        profile: {
          currentPoints: 86.5,
          targetPoints: 95,
          targetTier: 'Champion',
          availableSkillBadges: ['Kubernetes Basics'],
          email: 'private@example.test',
          profileUrl: 'https://private.example/profile',
          name: 'Private Name',
        },
      }),
    };
    const response = await api.handler(event);
    assert.strictEqual(response.statusCode, 200);
    const payload = JSON.parse(response.body);
    assert.strictEqual(payload.source, 'background-research+calculator-context');
    assert.strictEqual(payload.externalAi, false);
    assert.match(payload.reply, /Kubernetes Basics/);
    assert.strictEqual(payload.feed.pendingReviewCount, 0, 'chatbot feed must not expose pending review proposals');
    assert.strictEqual(payload.feed.knowledgeVersion, 'approved-test-v1');
    assert.ok(payload.feed.skillBadges.some(item => item.title === 'Kubernetes Basics'));
    assert.strictEqual(payload.feed.unresolvedCandidates.length, 0, 'unapproved candidate records must stay out of the chatbot context');
    assert.ok(payload.agentContext.calculator && payload.agentContext.today);
    assert.strictEqual(fetchCalls.filter(url => url.endsWith('/approved-knowledge.json')).length, 1, 'chat planning fetches the approved-only knowledge database');
    assert.strictEqual(fetchCalls.filter(url => url.endsWith('/public-feed.json')).length, 0, 'chat planning must not fetch the public discovery feed');
    assert.strictEqual(fetchCalls.filter(url => url.endsWith('/catalogue.json')).length, 0, 'chat planning must not fetch the unreviewed catalogue');
    assert.ok(fetchCalls.some(url => url.startsWith('https://www.bing.com/search?')), 'planning performs background web research');
    assert.doesNotMatch(response.body, /private@example\.test|private\.example\/profile|Private Name/);

    const researchIp = 'background-research-integration-test';
    const researchResponse = await api.handler({
      httpMethod: 'POST',
      headers: { 'x-nf-client-connection-ip': researchIp },
      body: JSON.stringify({
        action: 'plan',
        message: 'Any new Arcade swag drop or event today?',
        profile: { currentPoints: 12, targetPoints: 20, email: 'private@example.test', profileUrl: 'https://private.example/profile', name: 'Private Name' },
        history: [],
        timezone: 'Asia/Kolkata',
      }),
    });
    assert.strictEqual(researchResponse.statusCode, 200);
    const researchPayload = JSON.parse(researchResponse.body);
    assert.strictEqual(researchPayload.source, 'background-research+calculator-context');
    assert.ok(researchPayload.evidence.some(item => item.evidenceClass === 'official_announcement'));
    assert.ok(researchPayload.evidence.some(item => item.evidenceClass === 'community_report'));
    assert.ok(researchPayload.evidence.some(item => item.evidenceClass === 'news_discovery'));
    assert.ok(researchPayload.evidence.some(item => item.evidenceClass === 'official_channel_metadata'));
    assert.doesNotMatch(researchResponse.body, /private@example\.test|private\.example\/profile|Private Name|toolsSelected|providerStatus|private reasoning/);
    assert.ok(fetchCalls.some(url => url.startsWith('https://news.google.com/rss/search?')));
    assert.ok(fetchCalls.some(url => url.startsWith('https://discuss.google.dev/search.json?')));
    assert.ok(fetchCalls.some(url => url.startsWith('https://www.youtube.com/feeds/videos.xml?')));

    const generalResponse = await api.handler({
      httpMethod: 'POST',
      headers: { 'x-nf-client-connection-ip': 'general-question-integration-test' },
      body: JSON.stringify({ action: 'plan', message: 'How does photosynthesis work?', profile: {}, history: [], timezone: 'Asia/Kolkata' }),
    });
    assert.strictEqual(generalResponse.statusCode, 200);
    const generalPayload = JSON.parse(generalResponse.body);
    assert.strictEqual(generalPayload.source, 'background-research+calculator-context');
    assert.match(generalPayload.reply, /Gemini AI is not configured/i);
    assert.strictEqual(generalPayload.evidence.length, 0);
    assert.strictEqual(generalPayload.showSources, false);
    assert.strictEqual(generalPayload.feedWarning, null);
    assert.doesNotMatch(generalPayload.reply, /Arcade updates|source links|news roundup/i);
    assert.ok(!fetchCalls.some(url => url.startsWith('https://www.bing.com/search?') && /photosynthesis/i.test(url)), 'ordinary questions must not trigger unrelated web search');

    const unrelatedPlanResponse = await api.handler({
      httpMethod: 'POST',
      headers: { 'x-nf-client-connection-ip': 'unrelated-study-plan-integration-test' },
      body: JSON.stringify({ action: 'plan', message: 'Help me make a study plan for organic chemistry', profile: {}, history: [], timezone: 'Asia/Kolkata' }),
    });
    assert.strictEqual(unrelatedPlanResponse.statusCode, 200);
    assert.strictEqual(JSON.parse(unrelatedPlanResponse.body).source, 'background-research+calculator-context');
    assert.match(JSON.parse(unrelatedPlanResponse.body).reply, /Gemini AI is not configured/i);
    assert.strictEqual(JSON.parse(unrelatedPlanResponse.body).evidence.length, 0);

    const feedResponse = await api.handler({ httpMethod: 'GET', queryStringParameters: { m: 'feed' }, headers: {} });
    assert.strictEqual(feedResponse.statusCode, 200);
    assert.strictEqual(JSON.parse(feedResponse.body).feed.programmeEvents.length, 1);
    assert.strictEqual(fetchCalls.filter(url => url.endsWith('/public-feed.json')).length, 1, 'the separate public feed view can still read discovery observations');

    const rateTestIp = 'rate-limit-rule-agent-test-818';
    for (let i = 0; i < 2; i++) {
      const r = await api.handler({ ...event, headers: { 'x-nf-client-connection-ip': rateTestIp } });
      assert.strictEqual(r.statusCode, 200);
    }
    const limited = await api.handler({ ...event, headers: { 'x-nf-client-connection-ip': rateTestIp } });
    assert.strictEqual(limited.statusCode, 429);

    const unauthorizedDigest = await api.handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ action: 'send-approved-digest' }) });
    assert.strictEqual(unauthorizedDigest.statusCode, 401);

    const badMethod = await api.handler({ httpMethod: 'DELETE', headers: {} });
    assert.strictEqual(badMethod.statusCode, 405);

    const oversized = await api.handler({ httpMethod: 'POST', headers: {}, body: 'x'.repeat(12 * 1024 + 1) });
    assert.strictEqual(oversized.statusCode, 413);

    const fnText = fs.readFileSync(path.join(__dirname, '../netlify/functions/intelligence.js'), 'utf8');
    const appText = fs.readFileSync(path.join(__dirname, '../app-builtin.html'), 'utf8');
    const indexText = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    // The Netlify function may check for the presence of GEMINI_API_KEY and
    // delegate to the gemini-* modules, but must never perform the raw Gemini
    // HTTP call itself — that call is isolated to gemini-provider.mjs so it
    // stays easy to audit. The frontend must never see the key or call the
    // provider directly, under any name.
    assert.doesNotMatch(fnText, /generativelanguage\.googleapis\.com/);
    assert.doesNotMatch(appText, /arcAgentGemini|GEMINI_API_KEY|allowGemini|generativelanguage\.googleapis\.com/);
    assert.doesNotMatch(indexText, /arcAgentGemini|GEMINI_API_KEY|allowGemini|generativelanguage\.googleapis\.com/);
  } finally {
    global.fetch = oldFetch;
  }
  console.log('Intelligence tests passed: PII minimisation, source allowlisting, strict human approval, deterministic planning, hidden background research, no external AI requests, rate limiting, approved-only chatbot context, separate public-feed view, digest authentication, and request-size guards.');
})().catch(error => { console.error(error); process.exit(1); });
