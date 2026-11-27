'use strict';

// Arcade Intelligence API for the Journey Tracker.
// - Uses the public discovery feed only for its separate read-only feed view.
// - The chatbot research context is sourced exclusively from approved-knowledge.json.
// - A minimal, sanitised dashboard context and limited badge titles may be sent to Gemini when configured;
// - Sends owner email digests only for events that pass the same strict
//   human-approval gate used by the GitHub notification manager.

const crypto = require('crypto');

const FEED_URL = 'https://raw.githubusercontent.com/SubratNexus/arcade-intelligence-2.0/main/agent-data/public-feed.json';
const FEED_HOST = 'raw.githubusercontent.com';
const CATALOGUE_URL = 'https://raw.githubusercontent.com/SubratNexus/arcade-intelligence-2.0/main/agent-data/catalogue.json';
const APPROVED_KNOWLEDGE_URL = 'https://raw.githubusercontent.com/SubratNexus/arcade-intelligence-2.0/main/agent-data/approved-knowledge.json';
const STORE = 'site:arcade-intelligence';
const TRUSTED_AUTHOR_METHOD = 'discourse_google_staff_group';
const MAX_BODY_BYTES = 12 * 1024;
const MAX_FEED_BYTES = 1_200_000;
const FEED_CACHE_MS = 5 * 60 * 1000;
const feedCache = { data: null, at: 0 };
const catalogueCache = { data: null, at: 0 };
const approvedKnowledgeCache = { data: null, at: 0 };
const memory = { plans: Object.create(null), digests: Object.create(null) };

const J = (statusCode, payload, headers = {}) => ({
  statusCode,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  },
  body: JSON.stringify(payload),
});

const clamp = (value, min, max, fallback = min) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const cleanText = (value, max = 160) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const safeTitleList = (value, maxItems = 60) => Array.isArray(value)
  ? [...new Set(value.filter(x => typeof x === 'string').map(x => cleanText(x, 120)).filter(x => x.length >= 2))].slice(0, maxItems)
  : [];

function safeSourceUrl(value) {
  try {
    const u = new URL(String(value || ''));
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return '';
    if (!['discuss.google.dev', 'youtube.com', 'www.youtube.com'].includes(u.hostname)) return '';
    if (u.hostname === 'discuss.google.dev' && !u.pathname.startsWith('/t/')) return '';
    if (['youtube.com', 'www.youtube.com'].includes(u.hostname) && !u.pathname.startsWith('/watch')) return '';
    return u.toString();
  } catch { return ''; }
}

function safeKnowledgeUrl(value) {
  try {
    const u = new URL(String(value || ''));
    const hosts = ['skills.google', 'www.skills.google', 'cloudskillsboost.google', 'www.cloudskillsboost.google', 'cloud.google.com', 'www.cloud.google.com'];
    if (u.protocol !== 'https:' || u.username || u.password || u.port || !hosts.includes(u.hostname)) return '';
    return u.toString();
  } catch { return ''; }
}

function safeCount(value, max = 10000) { return Math.round(clamp(value, 0, max, 0)); }
function safePoint(value) { return Math.round(clamp(value, 0, 10000, 0) * 100) / 100; }

function sanitiseCalculatorContext(raw, profile) {
  const x = raw && typeof raw === 'object' ? raw : {};
  const r = x.rules && typeof x.rules === 'object' ? x.rules : {};
  const t = x.totals && typeof x.totals === 'object' ? x.totals : {};
  const counts = t.counts && typeof t.counts === 'object' ? t.counts : {};
  const breakdown = t.pointBreakdown && typeof t.pointBreakdown === 'object' ? t.pointBreakdown : {};
  const date = (value, fallback) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : fallback;
  const tiers = Array.isArray(r.tiers) ? r.tiers.slice(0, 8).map(item => ({
    name: cleanText(item && item.n, 30), minimum: safePoint(item && item.min)
  })).filter(item => item.name) : [];
  const milestones = Array.isArray(r.facilitatorMilestones) ? r.facilitatorMilestones.slice(0, 8).map(item => ({
    name: cleanText(item && item.name, 40), games: safeCount(item && item.games, 500),
    skills: safeCount(item && item.skills, 500), bonus: safePoint(item && item.bonus)
  })).filter(item => item.name) : [];
  return {
    rules: {
      version: cleanText(r.version || 'not supplied', 60),
      year: safeCount(r.year, 2100) || profile.seasonYear,
      windowStart: date(r.windowStart, profile.seasonYear + '-01-01'),
      windowEnd: date(r.windowEnd, profile.seasonYear + '-12-31'),
      updated: cleanText(r.updated, 40),
      pointValues: {
        game: safePoint(r.pointValues && r.pointValues.game),
        trivia: safePoint(r.pointValues && r.pointValues.trivia),
        special: safePoint(r.pointValues && r.pointValues.special),
        skill: safePoint(r.pointValues && r.pointValues.skill)
      },
      skillRounding: cleanText(r.skillRounding || (profile.roundSkillPointsDown ? 'floor to complete pairs of Skill Badges' : 'exact half-points'), 100),
      specialPointRule: 'Special +2 is a manual category override only; do not infer it.',
      tiers, facilitatorMilestones: milestones,
      facilitatorExtraBonus: safePoint(r.facilitatorExtraBonus)
    },
    totals: {
      currentPoints: profile.currentPoints,
      currentTier: profile.currentTier,
      targetTier: profile.targetTier,
      targetPoints: profile.targetPoints,
      pointsRemaining: profile.pointsRemaining,
      counts: { games: safeCount(counts.games), trivia: safeCount(counts.trivia), special: safeCount(counts.special), skills: safeCount(counts.skills) },
      pointBreakdown: { game: safePoint(breakdown.game), trivia: safePoint(breakdown.trivia), special: safePoint(breakdown.special), skill: safePoint(breakdown.skill), manual: profile.manualPoints, facilitator: profile.facilitatorPoints },
      manualEvents: safeCount(t.manualEvents, 100), facilitatorMilestone: cleanText(t.facilitatorMilestone, 40)
    },
    earnedBadgeTitles: safeTitleList(x.earnedBadgeTitles, 60).length ? safeTitleList(x.earnedBadgeTitles, 60) : profile.earnedBadgeTitles,
    unfinishedChecklist: safeTitleList(x.unfinishedChecklist, 40).length ? safeTitleList(x.unfinishedChecklist, 40) : profile.availableSkillBadges,
    planning: { hoursPerWeek: profile.hoursPerWeek, focus: profile.focus }
  };
}

function sanitiseTaskPlan(raw) {
  const x = raw && typeof raw === 'object' ? raw : {};
  const allowed = new Set(['web', 'news', 'community', 'intelligence', 'youtube', 'dashboard']);
  const tools = Array.isArray(x.tools) ? [...new Set(x.tools.filter(item => typeof item === 'string' && allowed.has(item)))].slice(0, 6) : [];
  return tools.length ? { taskType: cleanText(x.taskType || 'general_research', 50), tools } : null;
}

function applyQuestionGoal(profile, message) {
  const question = cleanText(message, 320);
  const additional = question.match(/\b(?:earn|achieve|gain|collect|get|add)\s+(?:another\s+)?(\d+(?:\.\d+)?)\s*(?:(?:more|additional)\s*)?(?:arcade\s*)?points?\b/i);
  const absolute = question.match(/\b(?:reach|get\s+to|target(?:\s+of)?|total(?:\s+of)?)\s+(\d+(?:\.\d+)?)\s*(?:arcade\s*)?points?\b/i);
  const match = additional || absolute;
  if (!match) return profile;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0 || value > 5000) return profile;
  const target = additional ? profile.currentPoints + value : value;
  profile.targetPoints = Math.round(target * 10) / 10;
  profile.pointsRemaining = Math.max(0, Math.round((profile.targetPoints - profile.currentPoints) * 10) / 10);
  profile.targetTier = additional ? `${value} additional points` : `Question target: ${value} points`;
  return profile;
}

function sanitiseProfile(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const target = clamp(p.targetPoints, 50, 5000, 120);
  const currentPoints = clamp(p.currentPoints, 0, 10000, 0);
  const remaining = Math.max(0, Math.round((target - currentPoints) * 10) / 10);
  return {
    currentPoints: Math.round(currentPoints * 10) / 10,
    currentTier: cleanText(p.currentTier || 'Not reached', 24),
    targetTier: cleanText(p.targetTier || 'Custom goal', 24),
    targetPoints: target,
    pointsRemaining: remaining,
    gameBadges: Math.round(clamp(p.gameBadges, 0, 1000, 0)),
    skillBadges: Math.round(clamp(p.skillBadges, 0, 1000, 0)),
    specialBadges: Math.round(clamp(p.specialBadges, 0, 1000, 0)),
    manualPoints: Math.round(clamp(p.manualPoints, 0, 10000, 0) * 100) / 100,
    facilitatorPoints: Math.round(clamp(p.facilitatorPoints, 0, 10000, 0) * 100) / 100,
    roundSkillPointsDown: p.roundSkillPointsDown === true,
    seasonYear: Math.round(clamp(p.seasonYear, 2020, 2100, new Date().getUTCFullYear())),
    hoursPerWeek: Math.round(clamp(p.hoursPerWeek, 1, 40, 4)),
    focus: ['balanced', 'skills', 'games', 'short-sessions'].includes(p.focus) ? p.focus : 'balanced',
    earnedBadgeTitles: safeTitleList(p.earnedBadgeTitles, 100),
    availableSkillBadges: safeTitleList(p.availableSkillBadges, 60),
  };
}

function isTrustedOfficialSource(event) {
  return Array.isArray(event && event.sources) && event.sources.some(source =>
    source && source.source_type === 'google_cloud_community'
    && source.source_domain === 'discuss.google.dev'
    && safeSourceUrl(source.source_url).startsWith('https://discuss.google.dev/t/')
    && source.is_google_staff_author === true
    && source.publisher_authority === 'google_staff_group'
    && source.author_verification_method === TRUSTED_AUTHOR_METHOD
  );
}

function approvedEvents(feed) {
  const events = feed && Array.isArray(feed.programme_events) ? feed.programme_events : [];
  return events.filter(event => event && event.verification_status === 'officially_announced'
    && event.human_review_required === false
    && event.notification_approved === true
    && isTrustedOfficialSource(event));
}

function compactFeed(feed, catalogue = null) {
  const all = feed && Array.isArray(feed.programme_events) ? feed.programme_events : [];
  const videos = feed && Array.isArray(feed.youtube_videos) ? feed.youtube_videos : [];
  const direct = catalogue && typeof catalogue === 'object' ? catalogue : {};
  const cleanEvents = all.slice(0, 50).map(e => ({
    title: cleanText(e.title, 180), type: cleanText(e.event_type, 40),
    verification: cleanText(e.verification_status, 50), needsHumanReview: e.human_review_required !== false,
    notificationApproved: e.notification_approved === true, publishedAt: cleanText(e.published_at, 40),
    lastObservedAt: cleanText(e.last_observed_at, 40),
    sourceUrls: (Array.isArray(e.source_urls) ? e.source_urls : []).map(value => safeSourceUrl(value)).filter(Boolean).slice(0, 3),
    pointsMentioned: Array.isArray(e.explicit_point_mentions) ? e.explicit_point_mentions.slice(0, 8).map(x => cleanText(x, 100)) : [],
    tierMentions: Array.isArray(e.tier_mentions) ? e.tier_mentions.slice(0, 8).map(x => cleanText(x, 50)) : [],
    verificationExplanation: cleanText(e.verification_explanation, 240)
  })).filter(e => e.title);

  const feedSkills = Array.isArray(feed && feed.skill_badges) ? feed.skill_badges : null;
  const feedGames = Array.isArray(feed && feed.arcade_games) ? feed.arcade_games : null;
  const feedCompletions = Array.isArray(feed && feed.completion_badges) ? feed.completion_badges : null;
  const catalogueSkills = Array.isArray(direct.entries) ? direct.entries.filter(item => item && item.category === 'skill' && item.verified === true) : [];
  const catalogueGames = Array.isArray(direct.game_entries) ? direct.game_entries.filter(item => item && item.verified === true) : [];
  const catalogueCompletions = Array.isArray(direct.completion_badges) ? direct.completion_badges.filter(item => item && item.verified === true) : [];
  const entity = (item, forcedCategory) => {
    if (!item || typeof item !== 'object' || item.verified !== true) return null;
    const title = cleanText(item.title, 180);
    if (title.length < 5 || ['google skills', 'cloud', 'google cloud', 'arcade', 'badge', 'skill badge'].includes(title.toLowerCase())) return null;
    const sourceUrl = safeKnowledgeUrl(item.source_url || item.sourceUrl || item.badge_url || item.badgeUrl);
    if (!sourceUrl) return null;
    const point = item.point_value ?? item.pointValue;
    return {
      title,
      category: cleanText(item.category || forcedCategory || 'unknown', 30),
      verified: true,
      status: cleanText(item.status || 'unconfirmed', 30),
      evidence: cleanText(item.evidence, 240),
      sourceUrl,
      pointValue: point !== null && point !== undefined && Number.isFinite(Number(point)) ? safePoint(point) : null,
      availabilityConfirmed: item.availability_confirmed === true || item.availabilityConfirmed === true,
      lastSeen: cleanText(item.last_seen || item.lastSeen, 40)
    };
  };
  const skills = (feedSkills || catalogueSkills).map(item => entity(item, 'skill')).filter(Boolean).slice(0, 250);
  const games = (feedGames || catalogueGames).map(item => entity(item, 'game')).filter(Boolean).slice(0, 250);
  const completions = (feedCompletions || catalogueCompletions).map(item => entity(item, 'completion')).filter(Boolean).slice(0, 100);
  const rawCandidates = Array.isArray(feed && feed.unresolved_candidates) ? feed.unresolved_candidates :
    (Array.isArray(direct.candidates) ? direct.candidates : []);
  const candidates = rawCandidates.slice(0, 80).map(item => {
    if (!item || typeof item !== 'object') return null;
    const sourceUrl = safeKnowledgeUrl(item.source_url || item.badge_url);
    const title = cleanText(item.title, 180);
    if (!sourceUrl || !title) return null;
    return { title, category: cleanText(item.category || 'unknown', 40), verified: false,
      reviewStatus: 'pending_review', confidence: Number.isFinite(Number(item.confidence)) ? clamp(item.confidence, 0, 1, 0) : null,
      evidence: cleanText(item.evidence, 240), sourceUrl, lastSeen: cleanText(item.last_seen, 40) };
  }).filter(Boolean);
  const rawHistory = Array.isArray(feed && feed.change_history) ? feed.change_history : [];
  const changeHistory = rawHistory.slice(-100).reverse().map(item => ({
    entityType: cleanText(item.entity_type, 40), entityId: cleanText(item.entity_id, 120),
    changeType: cleanText(item.change_type, 30), title: cleanText(item.title, 180),
    sourceUrl: safeKnowledgeUrl(item.source_url), verificationStatus: cleanText(item.verification_status, 60),
    detectedAt: cleanText(item.detected_at, 40)
  })).filter(item => item.title);
  const stats = direct.stats && typeof direct.stats === 'object' ? direct.stats : {};
  const summary = feed && feed.catalogue_summary && typeof feed.catalogue_summary === 'object' ? feed.catalogue_summary : {};
  const videosClean = videos.slice(0, 25).map(v => ({
    title: cleanText(v.title, 180), publishedAt: cleanText(v.published_at, 40),
    sourceUrl: safeSourceUrl(v.source_url), channel: cleanText(v.source_name, 80)
  })).filter(v => v.title && v.sourceUrl);
  return {
    generatedAt: cleanText(feed && feed.generated_at, 40), knowledgeVersion: cleanText(feed && feed.knowledge_version, 80),
    agent: cleanText(feed && feed.agent || 'Arcade Intelligence', 60),
    programmeEvents: cleanEvents,
    skillBadges: skills, arcadeGames: games, completionBadges: completions, unresolvedCandidates: candidates,
    changeHistory,
    catalogueSummary: {
      version: cleanText(summary.catalogue_version || direct.version, 40),
      lastRunAt: cleanText(summary.last_run_at || direct.last_run_at, 40),
      status: cleanText(summary.status || direct.status || 'unknown', 30),
      verifiedSkillBadges: safeCount(summary.verified_skill_badges ?? stats.verified_skill_badges ?? skills.length),
      verifiedArcadeGames: safeCount(summary.verified_arcade_games ?? stats.verified_game_badges ?? games.length),
      verifiedCompletionBadges: safeCount(summary.verified_completion_badges ?? stats.verified_completion_badges ?? completions.length),
      unresolvedCandidates: safeCount(summary.unresolved_candidates ?? stats.pending_candidates ?? candidates.length),
      pagesCrawled: safeCount(stats.pages_crawled), pageErrors: safeCount(stats.page_errors)
    },
    approvedEventCount: approvedEvents(feed).length,
    pendingReviewCount: cleanEvents.filter(e => e.needsHumanReview).length,
    youtubeVideos: videosClean,
    notice: cleanText(feed && feed.notice || direct.notice || 'Read-only public research. Badge catalogue entries do not prove current availability, eligibility or point awards.', 700)
  };
}

async function loadPublicFeed(force = false) {
  if (!force && feedCache.data && Date.now() - feedCache.at < FEED_CACHE_MS) {
    return { data: feedCache.data, cached: true, stale: false };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5500);
  try {
    const url = new URL(FEED_URL);
    if (url.hostname !== FEED_HOST || url.protocol !== 'https:') throw new Error('Feed URL allowlist failure');
    const response = await fetch(FEED_URL, {
      method: 'GET',
      redirect: 'manual',
      cache: 'no-store',
      signal: controller.signal,
      headers: { accept: 'application/json', 'user-agent': 'ArcadeJourneyTracker/8.8' },
    });
    if (!response.ok) throw new Error(`Public feed HTTP ${response.status}`);
    const raw = await response.text();
    if (Buffer.byteLength(raw, 'utf8') > MAX_FEED_BYTES) throw new Error('Public feed exceeded size limit');
    const data = JSON.parse(raw);
    if (data.schema_version !== 1 || !Array.isArray(data.programme_events) || !Array.isArray(data.youtube_videos)) {
      throw new Error('Public feed schema is unsupported');
    }
    feedCache.data = data;
    feedCache.at = Date.now();
    return { data, cached: false, stale: false };
  } catch (error) {
    if (feedCache.data) return { data: feedCache.data, cached: true, stale: true, error: cleanText(error.message, 120) };
    throw error;
  } finally {
    clearTimeout(timer);
  }
}


function approvedKnowledgeToFeed(database) {
  const feed = {
    schema_version: 1,
    agent: 'Arcade Intelligence approved knowledge',
    generated_at: cleanText(database && (database.updated_at || database.initialized_at), 40),
    knowledge_version: cleanText(database && database.knowledge_version, 80),
    programme_events: [], skill_badges: [], arcade_games: [], completion_badges: [],
    youtube_videos: [], unresolved_candidates: [], change_history: [],
    approved_knowledge_count: Array.isArray(database && database.items) ? database.items.length : 0,
    notice: 'The chatbot uses only owner-approved repository records. Public discovery queue items are not included.'
  };
  const items = Array.isArray(database && database.items) ? database.items.slice(0, 500) : [];
  for (const item of items) {
    if (!item || typeof item !== 'object' || !item.approved_at || !item.approval_method ||
        !item.record || typeof item.record !== 'object') continue;
    const record = { ...item.record, title: cleanText(item.title || item.record.title, 180) };
    if (!record.title) continue;
    if (item.entity_type === 'programme_event') {
      const trusted = isTrustedOfficialSource(record);
      const approvedRecord = {
        ...record,
        event_id: cleanText(record.event_id || item.entity_id, 120),
        human_review_required: false,
        notification_approved: trusted && record.verification_status === 'officially_announced',
        review_decision: 'approved'
      };
      feed.programme_events.push(approvedRecord);
    } else if (item.entity_type === 'skill_badge') {
      feed.skill_badges.push({ ...record, verified: true, status: 'owner_approved', source_url: record.source_url || record.badge_url || item.source_url });
    } else if (item.entity_type === 'arcade_game') {
      feed.arcade_games.push({ ...record, verified: true, status: 'owner_approved', source_url: record.source_url || record.badge_url || item.source_url });
    } else if (item.entity_type === 'completion_badge') {
      feed.completion_badges.push({ ...record, verified: true, status: 'owner_approved', source_url: record.source_url || record.badge_url || item.source_url });
    } else if (item.entity_type === 'youtube_video') {
      feed.youtube_videos.push({ ...record, source_url: record.source_url || item.source_url });
    }
  }
  return feed;
}

async function loadApprovedKnowledge(force = false) {
  if (!force && approvedKnowledgeCache.data && Date.now() - approvedKnowledgeCache.at < FEED_CACHE_MS) {
    return { data: approvedKnowledgeCache.data, cached: true, stale: false };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5500);
  try {
    const url = new URL(APPROVED_KNOWLEDGE_URL);
    if (url.hostname !== FEED_HOST || url.protocol !== 'https:') throw new Error('Approved knowledge URL allowlist failure');
    const response = await fetch(APPROVED_KNOWLEDGE_URL, {
      method: 'GET', redirect: 'manual', cache: 'no-store', signal: controller.signal,
      headers: { accept: 'application/json', 'user-agent': 'ArcadeJourneyTracker/9.1.1' }
    });
    if (!response.ok) throw new Error(`Approved knowledge HTTP ${response.status}`);
    const raw = await response.text();
    if (Buffer.byteLength(raw, 'utf8') > MAX_FEED_BYTES) throw new Error('Approved knowledge exceeded size limit');
    const data = JSON.parse(raw);
    if (data.schema_version !== 1 || data.initialization_status !== 'initialized' || !Array.isArray(data.items)) {
      throw new Error('Approved knowledge schema is unsupported or has not been initialized');
    }
    approvedKnowledgeCache.data = data;
    approvedKnowledgeCache.at = Date.now();
    return { data, cached: false, stale: false };
  } catch (error) {
    if (approvedKnowledgeCache.data) return { data: approvedKnowledgeCache.data, cached: true, stale: true, error: cleanText(error.message, 120) };
    throw error;
  } finally { clearTimeout(timer); }
}

async function loadPublicCatalogue(force = false) {
  if (!force && catalogueCache.data && Date.now() - catalogueCache.at < FEED_CACHE_MS) {
    return { data: catalogueCache.data, cached: true };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const url = new URL(CATALOGUE_URL);
    if (url.hostname !== FEED_HOST || url.protocol !== 'https:') throw new Error('Catalogue URL allowlist failure');
    const response = await fetch(CATALOGUE_URL, { method: 'GET', redirect: 'manual', cache: 'no-store', signal: controller.signal,
      headers: { accept: 'application/json', 'user-agent': 'ArcadeJourneyTracker/8.8' } });
    if (!response.ok) throw new Error(`Catalogue HTTP ${response.status}`);
    const raw = await response.text();
    if (Buffer.byteLength(raw, 'utf8') > 500_000) throw new Error('Catalogue exceeded size limit');
    const data = JSON.parse(raw);
    if (data.schema_version !== 1 || !Array.isArray(data.entries)) throw new Error('Catalogue schema is unsupported');
    catalogueCache.data = data; catalogueCache.at = Date.now();
    return { data, cached: false };
  } catch (error) {
    if (catalogueCache.data) return { data: catalogueCache.data, cached: true, stale: true, error: cleanText(error.message, 120) };
    throw error;
  } finally { clearTimeout(timer); }
}

function fallbackPlan(profile, feed, message) {
  const q = cleanText(message, 320);
  const lower = q.toLowerCase();
  const verified = approvedEvents(feed);
  const allEvents = feed && Array.isArray(feed.programme_events) ? feed.programme_events : [];
  const videos = feed && Array.isArray(feed.youtube_videos) ? feed.youtube_videos : [];
  const pending = allEvents.filter(e => e && e.verification_status === 'officially_announced' && e.human_review_required !== false).length;
  const skills = profile.availableSkillBadges.slice(0, 8);

  const asksNews = /announcement|news|event|bonus|prize|swag|deadline|drop|promotion/.test(lower);
  const asksVideo = /youtube|video|watch|channel/.test(lower);
  const asksSkill = /skill badge|skill badges|checklist|unfinished badge|next badge/.test(lower);
  const asksGame = /game|trivia|arcade game/.test(lower);
  const asksTarget = /target|reach|points needed|how many points|points left|remaining points|shortfall|tier|achieve.{0,30}points|earn.{0,30}points|programme end|program end|till the end|until the end|by the end/.test(lower);
  const asksTime = /time|hours|weekly|week|schedule|routine|plan|next step|what should i do|what next/.test(lower);
  const lines = [];

  // Personal calculator facts are included only for personal planning questions,
  // not for announcements, videos, or unrelated general research.
  if (asksSkill || asksGame || asksTarget || asksTime) {
    lines.push(`Your current estimate is ${profile.currentPoints} Arcade points (${profile.currentTier}).`);
    lines.push(profile.pointsRemaining > 0
      ? `Your selected target is ${profile.targetTier} at ${profile.targetPoints} points; ${profile.pointsRemaining} points remain.`
      : `You have reached your selected target of ${profile.targetPoints} points.`);
    lines.push(`Your calculator currently counts ${profile.gameBadges} game/trivia badges and ${profile.skillBadges} Skill Badges.`);
    if (asksTime) lines.push(`Your planning preference is ${profile.hoursPerWeek} hours per week with a ${profile.focus.replace('-', ' ')} focus.`);
  }

  if (asksNews) {
    lines.push('Verified programme announcements:');
    if (verified.length) verified.slice(0, 5).forEach(e => {
      const link = Array.isArray(e.source_urls) ? e.source_urls.map(safeSourceUrl).find(Boolean) : '';
      lines.push(`• ${cleanText(e.title, 160)}${link ? ` — ${link}` : ''}`);
    });
    else lines.push('No programme announcement has passed both the trusted-source check and the human-approval gate in the current feed.');
    if (pending) lines.push(`${pending} official-source candidate(s) are still awaiting human review. Treat them as leads only; they are not confirmed participant opportunities.`);
    lines.push('Open the original official announcement to confirm dates, eligibility, availability and exact points before acting.');
  } else if (asksVideo) {
    if (videos.length) {
      lines.push('Matching videos currently present in the public feed:');
      videos.slice(0, 5).forEach(v => lines.push(`• ${cleanText(v.title, 150)}${safeSourceUrl(v.sourceUrl || v.source_url) ? ` — ${safeSourceUrl(v.sourceUrl || v.source_url)}` : ''}`));
    } else lines.push('There are currently no matching videos in the public intelligence feed. This does not prove that the channels have no newer videos; it means none are indexed in this feed right now.');
  } else if (asksSkill) {
    if (skills.length) {
      lines.push('Unfinished checklist titles to investigate next:');
      skills.slice(0, 6).forEach((title, i) => lines.push(`${i + 1}. ${title}`));
      lines.push('Checklist presence is not a guarantee that a badge is currently available or eligible. Open Google Skills to verify availability and completion requirements.');
    } else lines.push('Your supplied checklist has no unfinished active Skill Badge entries. Refresh the catalogue and confirm the current Google Skills catalogue before choosing another activity.');
  } else if (asksGame) {
    lines.push(`Your calculator currently counts ${profile.gameBadges} game/trivia badge(s). Check the official Google Skills Arcade catalogue for games that are open to your account; the personal planner does not assume a game is currently available.`);
    if (profile.pointsRemaining > 0) lines.push(`Under the calculator's current estimate, each counted game/trivia badge contributes 1 point, so around ${Math.ceil(profile.pointsRemaining)} additional counted badge(s) would cover the remaining gap. Confirm the official rules and your eligibility.`);
  } else if (asksTarget) {
    if (profile.pointsRemaining > 0) {
      lines.push(`To cover a ${profile.pointsRemaining}-point gap, the calculator's simple estimate is about ${Math.ceil(profile.pointsRemaining)} counted game/trivia badges or ${Math.ceil(profile.pointsRemaining * 2)} Skill Badges.`);
      lines.push('This is a calculator estimate, not a guarantee. Badge eligibility, programme dates, point rules and the selected skill-point rounding mode can change the result.');
    } else lines.push('Your current estimate is already at or above the selected target. Review the tier rules on the official programme page before relying on the result.');
  } else if (asksTime) {
    const hours = profile.hoursPerWeek;
    const focus = profile.focus;
    lines.push(`A manageable ${hours}-hour weekly structure: split the time into ${hours >= 4 ? 'two or three' : 'one or two'} focused sessions, leave a short review block, and stop when the session goal is complete.`);
    if (focus === 'skills') lines.push('Focus order: choose one unfinished Skill Badge from the checklist, read its requirements, then reserve the next session to finish and confirm the badge on your profile.');
    else if (focus === 'games') lines.push('Focus order: check which Arcade games are currently open to you, complete one eligible activity at a time, and sync your public profile after the badge appears.');
    else if (focus === 'short-sessions') lines.push('Focus order: use short sessions with one clear task each; keep a small buffer for profile syncing and checking earned dates.');
    else lines.push('Focus order: alternate one verified Skill Badge activity with one currently available Arcade activity, then sync your profile to update the point estimate.');
    if (skills.length) lines.push(`One checklist item to review first: ${skills[0]}. Its current availability still needs confirmation on Google Skills.`);
  } else {
    lines.push('I can help with Arcade points, unfinished Skill Badge checklist items, currently available games, weekly planning, programme announcements and indexed videos.');
  }

  if (pending && !asksNews) lines.push(`${pending} official-source candidate(s) are still awaiting human review. Treat them as leads only; they are not confirmed participant opportunities.`);
  if (/programme end|program end|till the end|until the end|by the end/i.test(lower)) lines.push('The current calculator feed does not provide a structured, independently verified programme-end date, so I will not calculate days remaining from an assumed deadline. Check the linked official sources for the latest date.');
  if (asksSkill || asksGame || asksTarget || asksTime) lines.push('Point model reminder: this calculator estimates 1 point per counted game/trivia badge and 0.5 point per Skill Badge, with the selected rounding mode applied. Confirm current rules and availability on official Google sources.');
  return lines.join('\n');
}

function tokenSecret() {
  const hash = process.env.ADMIN_PASSWORD_HASH || '34d094e6f9dd5d7d79fbef5e60b3f176:e7f745b602491e7455af4f69e12691a97836cc704f9e8efbba9b68d0f0520ae9';
  return process.env.TOKEN_SECRET || crypto.createHash('sha256').update('arcade-dev|' + hash).digest('hex');
}
function tokenOk(headers) {
  try {
    const token = String((headers || {}).authorization || '').replace(/^Bearer\s+/i, '');
    const [body, signature] = token.split('.');
    if (!body || !signature) return false;
    const expected = crypto.createHmac('sha256', tokenSecret()).update(body).digest('base64url');
    const a = Buffer.from(expected), b = Buffer.from(signature);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')).exp > Date.now();
  } catch { return false; }
}

function blobsContext(event) {
  try {
    const siteID = (event.headers || {})['x-nf-site-id'] || process.env.SITE_ID;
    let data = null;
    if (event.blobs) data = JSON.parse(Buffer.from(event.blobs, 'base64').toString('utf8'));
    else if (process.env.NETLIFY_BLOBS_CONTEXT) {
      data = JSON.parse(Buffer.from(process.env.NETLIFY_BLOBS_CONTEXT, 'base64').toString('utf8'));
      data.url = data.url || data.edgeURL;
    }
    if (!data || !data.token || !(data.url || data.edgeURL) || !siteID) return null;
    return { url: data.url || data.edgeURL, fresh: data.uncachedEdgeURL || data.url || data.edgeURL, token: data.token, siteID };
  } catch { return null; }
}
const blobUrl = (base, ctx, key) => new URL(`/${ctx.siteID}/${STORE}/${key}`, base).toString();
async function blobGet(ctx, key) {
  const response = await fetch(blobUrl(ctx.fresh, ctx, key), { headers: { authorization: `Bearer ${ctx.token}`, 'cache-control': 'no-cache' }, cache: 'no-store' });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`blob read failed (${response.status})`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
async function blobSet(ctx, key, value) {
  const response = await fetch(blobUrl(ctx.url, ctx, key), { method: 'PUT', headers: { authorization: `Bearer ${ctx.token}`, 'content-type': 'application/json' }, body: JSON.stringify(value) });
  if (!response.ok) throw new Error(`blob write failed (${response.status})`);
}

function escapeMail(value) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
}
function eventFingerprint(event) {
  return crypto.createHash('sha256').update(JSON.stringify({
    id: event.event_id,
    title: event.title,
    published_at: event.published_at,
    sources: (event.source_urls || []).filter(safeSourceUrl).sort(),
    points: event.explicit_point_mentions || [],
    tiers: event.tier_mentions || [],
  })).digest('hex');
}

async function sendApprovedDigest(event, feed) {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.OWNER_EMAIL;
  if (!key || !to) return { ok: false, statusCode: 503, error: 'Email is not configured. Add RESEND_API_KEY and OWNER_EMAIL in Netlify.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { ok: false, statusCode: 503, error: 'OWNER_EMAIL must be a valid email address.' };
  const ctx = blobsContext(event);
  if (!ctx) return { ok: false, statusCode: 503, error: 'Netlify Blobs is unavailable; digest sending is paused to prevent duplicate emails.' };
  const approved = approvedEvents(feed).slice(0, 40);
  if (!approved.length) return { ok: true, sent: false, count: 0, message: 'No human-approved official announcements are waiting for email.' };
  let loadedState;
  try { loadedState = await blobGet(ctx, 'mail-state'); }
  catch { return { ok: false, statusCode: 503, error: 'Netlify Blobs could not be read; digest sending is paused to prevent duplicate emails.' }; }
  const state = loadedState || { sent: {} };
  const sentMap = state && state.sent && typeof state.sent === 'object' ? state.sent : {};
  const pending = approved.filter(item => sentMap[item.event_id] !== eventFingerprint(item));
  if (!pending.length) return { ok: true, sent: false, count: 0, message: 'All currently approved announcements have already been emailed.' };

  const lines = [
    'ARCADE INTELLIGENCE — HUMAN-APPROVED DIGEST',
    `Feed generated: ${escapeMail(feed.generated_at || 'unknown')}`,
    '',
    'These items passed the strict official-source and human-approval gate.',
    'Point mentions are quoted from sources; they are not independent point-award calculations.',
    '',
  ];
  for (const item of pending) {
    lines.push(`TITLE: ${escapeMail(item.title)}`);
    lines.push(`TYPE: ${escapeMail(item.event_type)}`);
    lines.push(`PUBLISHED: ${escapeMail(item.published_at || 'not available')}`);
    lines.push(`EVIDENCE: ${escapeMail(item.verification_explanation || '')}`);
    const points = Array.isArray(item.explicit_point_mentions) ? item.explicit_point_mentions.slice(0, 10) : [];
    lines.push(`POINT MENTIONS: ${points.length ? points.map(escapeMail).join('; ') : 'None extracted'}`);
    const links = Array.isArray(item.source_urls) ? item.source_urls.map(safeSourceUrl).filter(Boolean).slice(0, 5) : [];
    lines.push(`SOURCES: ${links.length ? links.join(' | ') : 'No safe source URL available'}`);
    lines.push('');
  }
  lines.push('Always open the original source before making programme or calculator changes.');

  const idempotency = crypto.createHash('sha256').update(pending.map(eventFingerprint).sort().join('|')).digest('hex');
  const mailController = new AbortController();
  const mailTimer = setTimeout(() => mailController.abort(), 9000);
  let response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      redirect: 'error',
      signal: mailController.signal,
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'Idempotency-Key': idempotency },
      body: JSON.stringify({
        from: process.env.MAIL_FROM || 'Arcade Tracker <onboarding@resend.dev>',
        to: [to],
        subject: `Arcade Intelligence: ${pending.length} human-approved update${pending.length === 1 ? '' : 's'}`,
        text: lines.join('\n'),
      }),
    });
  } catch {
    return { ok: false, statusCode: 502, error: 'Email provider could not be reached; no delivery was confirmed.' };
  } finally { clearTimeout(mailTimer); }
  if (!response.ok) return { ok: false, statusCode: response.status === 429 ? 429 : 502, error: `Email provider rejected the digest (HTTP ${response.status}).` };
  const result = await response.json().catch(() => ({}));
  for (const item of pending) sentMap[item.event_id] = eventFingerprint(item);
  const compactSent = Object.fromEntries(Object.entries(sentMap).slice(-1000));
  await blobSet(ctx, 'mail-state', { schema_version: 1, updated_at: new Date().toISOString(), sent: compactSent });
  return { ok: true, sent: true, count: pending.length, providerId: cleanText(result.id || '', 100) };
}

// Lightweight, dependency-free config check mirrored from gemini-provider.mjs
// so the GET ?m=health route never has to dynamic-import the AI module.
function aiConfigured() {
  const provider = String(process.env.AI_PROVIDER || 'gemini').toLowerCase();
  return provider === 'gemini' && !!process.env.GEMINI_API_KEY;
}
function aiModelName() {
  return String(process.env.GEMINI_MODEL || 'gemini-3.8-flash').trim() || 'gemini-3.8-flash';
}

function rateAllowed(map, key, limit, windowMs) {
  const now = Date.now();
  const hits = (map[key] || []).filter(time => now - time < windowMs);
  if (hits.length >= limit) { map[key] = hits; return false; }
  hits.push(now); map[key] = hits;
  return true;
}

exports.handler = async event => {
  const method = event.httpMethod || 'GET';
  const query = event.queryStringParameters || {};
  const ip = (event.headers || {})['x-nf-client-connection-ip'] || 'unknown';
  if (method === 'GET') {
    if (query.m === 'health') {
      return J(200, { ok: true, service: 'arcade-intelligence', feedConfigured: true,
        externalAi: aiConfigured(), aiProvider: aiConfigured() ? 'gemini' : null, aiModel: aiConfigured() ? aiModelName() : null,
        emailConfigured: !!(process.env.RESEND_API_KEY && process.env.OWNER_EMAIL), feedSource: 'SubratNexus/arcade-intelligence-2.0/agent-data/approved-knowledge.json (chatbot)', checkedAt: new Date().toISOString() });
    }
    if (query.m === 'feed') {
      try {
        const result = await loadPublicFeed(query.fresh === '1');
        let catalogue = null, catalogueWarning = null;
        try { catalogue = (await loadPublicCatalogue(query.fresh === '1')).data; }
        catch (error) { catalogueWarning = cleanText(error.message, 120); }
        return J(200, { ok: true, feed: compactFeed(result.data, catalogue), cached: result.cached, stale: result.stale,
          warning: result.error || catalogueWarning || null }, { 'cache-control': 'public, max-age=120, stale-while-revalidate=300' });
      } catch {
        return J(503, { ok: false, error: 'The public intelligence feed is temporarily unavailable.' });
      }
    }
    return J(400, { ok: false, error: 'Use ?m=health or ?m=feed.' });
  }
  if (method !== 'POST') return J(405, { ok: false, error: 'Method not allowed.' }, { allow: 'GET, POST' });
  const rawBody = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : String(event.body || '');
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) return J(413, { ok: false, error: 'Request is too large.' });
  let body;
  try { body = JSON.parse(rawBody || '{}'); } catch { return J(400, { ok: false, error: 'Request must be valid JSON.' }); }

  if (body.action === 'send-approved-digest') {
    if (!tokenOk(event.headers)) return J(401, { ok: false, error: 'Developer Mode login is required.' });
    if (!rateAllowed(memory.digests, ip, 1, 60_000)) return J(429, { ok: false, error: 'Please wait before sending another digest.' });
    try {
      const { data } = await loadPublicFeed(true);
      const result = await sendApprovedDigest(event, data);
      return J(result.statusCode || 200, result);
    } catch {
      return J(502, { ok: false, error: 'The approved digest could not be sent. Check Netlify function logs.' });
    }
  }

  if (body.action !== 'plan') return J(400, { ok: false, error: 'Unknown intelligence action.' });
  if (!rateAllowed(memory.plans, ip, 2, 60_000)) return J(429, { ok: false, error: 'Planner limit reached for this minute. Please try again shortly.' });
  const message = cleanText(body.message || 'Build my personalised Arcade plan.', 1200);
  const profile = applyQuestionGoal(sanitiseProfile(body.profile), message);
  let feed = { programme_events: [], youtube_videos: [], skill_badges: [], arcade_games: [], completion_badges: [], generated_at: null, knowledge_version: null };
  let approvedDatabase = { schema_version: 1, initialization_status: 'initialized', items: [], knowledge_version: null };
  let feedWarning = '';

  const history = Array.isArray(body.history) ? body.history.slice(-8).map(item => ({
    role: item && item.role === 'assistant' ? 'assistant' : 'user',
    content: cleanText(item && item.content, 900),
  })).filter(item => item.content) : [];
  const taskPlan = sanitiseTaskPlan(body.taskPlan);
  const calculator = sanitiseCalculatorContext(body.calculatorContext, profile);
  let research = null;
  let researchWarning = '';
  let researchNeeded = false;
  try {
    const plannerModule = await import('../lib/arcade-buddy/planner.mjs');
    researchNeeded = plannerModule.buildResearchPlan(message, taskPlan).requiresResearch;
  } catch { researchNeeded = true; }
  if (researchNeeded) {
    try {
      const result = await loadApprovedKnowledge(false);
      approvedDatabase = result.data;
      feed = approvedKnowledgeToFeed(approvedDatabase);
      if (result.stale) feedWarning = 'Using the last cached owner-approved knowledge database because the latest refresh failed.';
    } catch {
      // Fail closed: never fall back to public-feed.json or review-queue.json for chatbot knowledge.
      feedWarning = 'The owner-approved knowledge database is temporarily unavailable; unapproved discoveries were not used.';
    }
  }
  try {
    const { answerQuestion } = await import('../lib/arcade-buddy/agent-core.mjs');
    research = await answerQuestion({
      question: message,
      history,
      timezone: cleanText(body.timezone || 'Asia/Kolkata', 80),
      dashboard: {},
      taskPlan,
    }, { feedData: approvedDatabase });
  } catch (error) {
    researchWarning = 'Background research could not be completed for this request. The source-based fallback is available.';
  }

  let aiReply = null;
  let aiModel = null;
  let aiFailureReason = null;
  if (aiConfigured()) {
    try {
      const { generateGeminiAnswer } = await import('../lib/arcade-buddy/gemini-agent.mjs');
      const aiResult = await generateGeminiAnswer({
        question: message,
        history,
        evidence: (research && Array.isArray(research.evidence)) ? research.evidence : [],
        strategy: (research && research.strategy) || null,
        calculator,
        timeZone: cleanText(body.timezone || 'Asia/Kolkata', 80),
        researchRequested: researchNeeded,
      });
      if (aiResult.ok) {
        aiReply = aiResult.text;
        aiModel = aiResult.model;
      } else if (aiResult.reason !== 'not_configured') {
        aiFailureReason = aiResult.reason;
      }
    } catch (error) {
      aiFailureReason = 'ai_module_error';
    }
  }

  const arcadeContextPattern = /\b(arcade|google skills|skill badges?|arcade points|arcade games?|trivia badges?|tier|swag|programme|program)\b/i;
  const hasArcadeContext = arcadeContextPattern.test(message)
    || /\b(how many points|points needed|points left|remaining points|reach.{0,30}points|earn.{0,30}points)\b/i.test(message)
    || history.some(item => item.role === 'user' && arcadeContextPattern.test(item.content));
  const explicitPersonalIntent = /(my plan|personalised|personalized|my points|my target|how many points|points needed|points left|remaining points|reach my|achieve my|achieve.{0,30}points|reach.{0,30}points|earn.{0,30}points|programme end|program end|till the end|until the end|by the end|skill badge|checklist|weekly plan|study plan|time available)/i.test(message);
  const followUpPersonalIntent = /(what should i do|what next|next step)/i.test(message) && hasArcadeContext;
  const personalReply = hasArcadeContext && (explicitPersonalIntent || followUpPersonalIntent)
    ? fallbackPlan(profile, feed, message)
    : '';
  const researchReply = researchNeeded
    ? (research && research.answer ? research.answer : researchWarning)
    : '';
  const noAiMessage = aiFailureReason
    ? 'Gemini could not answer this message right now. Please try again in a moment.'
    : 'Gemini AI is not configured for this deploy. Add GEMINI_API_KEY in Netlify to enable natural-language answers.';
  const deterministicReply = personalReply || researchReply || noAiMessage;
  const reply = aiReply || deterministicReply;
  const compact = researchNeeded ? compactFeed(feed, null) : null;
  const evidence = researchNeeded && research && research.showSources && Array.isArray(research.evidence)
    ? research.evidence.slice(0, 12) : [];
  const agentContext = {
    today: new Date().toISOString(),
    timezone: cleanText(body.timezone || 'Asia/Kolkata', 80),
    calculator,
    feed: compact,
    research: { answer: researchReply, evidence },
  };
  const aiNote = aiReply
    ? null
    : (aiFailureReason
      ? 'The AI model could not answer this turn (' + aiFailureReason + '); showing the deterministic research summary instead.'
      : (aiConfigured() ? null : 'No AI provider is configured yet (set AI_PROVIDER and GEMINI_API_KEY in Netlify); showing the deterministic research summary.'));
  return J(200, {
    ok: true,
    reply,
    evidence,
    source: aiReply ? 'gemini+background-research+calculator-context' : 'background-research+calculator-context',
    externalAi: !!aiReply,
    localAi: false,
    aiApiKeyRequired: !aiConfigured(),
    aiModel,
    aiNote,
    feed: compact,
    agentContext,
    taskPlanAccepted: !!taskPlan,
    feedWarning: researchNeeded ? (feedWarning || researchWarning || null) : null,
    researchUsed: !!(researchNeeded && research && research.requiresResearch),
    showSources: evidence.length > 0,
    privacy: 'The app sends only calculator totals, rule values, and limited badge titles to its own Netlify function (and, when an AI provider is configured, to that provider). Public research providers and the AI provider receive a redacted question and dashboard totals, not your profile URL, display name, email address, or Google login data.',
  });
};

exports._test = {
  sanitiseProfile,
  applyQuestionGoal,
  safeSourceUrl,
  isTrustedOfficialSource,
  approvedEvents,
  fallbackPlan,
  compactFeed,
  sanitiseCalculatorContext,
  sanitiseTaskPlan,
  safeKnowledgeUrl,
  rateAllowed,
  loadPublicFeed,
  aiConfigured,
  aiModelName,
};
