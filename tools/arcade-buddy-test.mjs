import test from "node:test";
import assert from "node:assert/strict";
import { buildResearchPlan, classifyTask, redactSearchText, resolveFollowUp, requiresResearch } from "../netlify/lib/arcade-buddy/planner.mjs";
import { calculateStrategy } from "../netlify/lib/arcade-buddy/strategy.mjs";
import { normalizeEvidence } from "../netlify/lib/arcade-buddy/evidence.mjs";
import { parseBingRss, parseGoogleNewsRss } from "../netlify/lib/arcade-buddy/providers.mjs";
import { answerQuestion } from "../netlify/lib/arcade-buddy/agent-core.mjs";

test("planner selects Google News, community and repository for Arcade swag news", () => {
  const plan = buildResearchPlan("Has Google announced a new Arcade swag drop today?");
  assert.equal(plan.arcadeRelated, true);
  assert.equal(plan.useGoogleNews, true);
  assert.equal(plan.useCommunity, true);
  assert.equal(plan.useRepository, true);
  assert.equal(plan.taskType, "live_status");
});

test("planner keeps general evergreen questions broad", () => {
  const plan = buildResearchPlan("Explain how a solar eclipse works.");
  assert.equal(plan.arcadeRelated, false);
  assert.equal(plan.useCommunity, false);
  assert.equal(plan.useRepository, false);
  assert.equal(plan.useGoogleNews, false);
  assert.equal(classifyTask("Explain how a solar eclipse works."), "general_research");
});

test("strategy question activates deterministic calculation and live research for Arcade plans", () => {
  assert.equal(classifyTask("How can I reach 20 points by the programme end?"), "strategy");
  assert.equal(requiresResearch("How can I earn 20 more Arcade points?"), true);
  assert.equal(requiresResearch("Build my personalised Arcade plan"), true);
  assert.equal(requiresResearch("How many points do I currently have?"), false);
});

test("follow-up keeps previous topic", () => {
  const resolved = resolveFollowUp("What about tomorrow?", [{ role: "user", content: "Which Arcade programme is active this week?" }]);
  assert.match(resolved, /Arcade programme/);
  assert.match(resolved, /tomorrow/i);
});

test("search privacy removes email, phone, secrets and profile URLs", () => {
  const cleaned = redactSearchText("Find this profile https://example.com/profile/123 me@example.com phone +91 9876543210 api_key=secret");
  assert.doesNotMatch(cleaned, /me@example.com|9876543210|api_key=secret|https:\/\//);
});

test("strategy excludes rumours, completed items and expired opportunities", () => {
  const dashboard = {
    currentPoints: 12,
    targetPoints: 20,
    opportunities: [
      { title: "Verified game", points: 5, eligible: true, verificationStatus: "verified", sourceUrl: "https://skills.google/catalog" },
      { title: "Community rumour", points: 50, eligible: true, verificationStatus: "community_report", sourceUrl: "https://discuss.google.dev/t/example/1" },
      { title: "Expired badge", points: 8, eligible: true, verificationStatus: "verified", sourceUrl: "https://skills.google/catalog", availableUntil: "2025-01-01" },
      { title: "Already completed", points: 8, eligible: true, verificationStatus: "verified", sourceUrl: "https://skills.google/catalog", completed: true }
    ]
  };
  const result = calculateStrategy(dashboard, new Date("2026-11-27T00:00:00Z"));
  assert.equal(result.status, "insufficient_verified_opportunities");
  assert.equal(result.pointsNeeded, 8);
  assert.equal(result.verifiedPointsAvailable, 5);
});

test("strategy finds a minimum-activity route", () => {
  const result = calculateStrategy({
    currentPoints: 10, targetPoints: 18,
    opportunities: [
      { title: "Five points", points: 5, eligible: true, verificationStatus: "verified", sourceUrl: "https://skills.google/catalog" },
      { title: "Three points", points: 3, eligible: true, verificationStatus: "verified", sourceUrl: "https://skills.google/catalog" },
      { title: "Eight points", points: 8, eligible: true, verificationStatus: "verified", sourceUrl: "https://skills.google/catalog" }
    ]
  }, new Date("2026-11-27T00:00:00Z"));
  assert.equal(result.status, "route_found");
  assert.equal(result.plannedPoints, 8);
  assert.equal(result.route.length, 1);
});

test("official classification requires exact trusted metadata", () => {
  const official = normalizeEvidence([{
    title: "Official Arcade post", url: "https://discuss.google.dev/t/example/1",
    sourceType: "intelligence_repository", verificationStatus: "officially_announced", officialSourceMetadata: true
  }]);
  assert.equal(official[0].evidenceClass, "official_announcement");
  const untrusted = normalizeEvidence([{
    title: "Looks official", url: "https://discuss.google.dev/t/example/2",
    sourceType: "intelligence_repository", verificationStatus: "officially_announced", officialSourceMetadata: false
  }]);
  assert.notEqual(untrusted[0].evidenceClass, "official_announcement");
});

test("evidence normalizer rejects unsafe links and separates Google News discoveries", () => {
  const evidence = normalizeEvidence([
    { title: "News", url: "https://news.google.com/rss/articles/abc", sourceType: "google_news" },
    { title: "Unsafe", url: "javascript:alert(1)" },
    { title: "Duplicate", url: "https://news.google.com/rss/articles/abc#fragment", sourceType: "google_news" }
  ]);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].evidenceClass, "news_discovery");
});

test("Bing RSS parser only accepts HTTPS links", () => {
  const parsed = parseBingRss(`<rss><channel><item><title>Example</title><link>https://example.com/a</link><description>Info</description></item><item><title>Unsafe</title><link>http://example.com</link></item></channel></rss>`);
  assert.equal(parsed.length, 1);
});

test("Google News parser retains publisher and marks discovery only", () => {
  const xml = `<rss><channel><item><title>Arcade event announced</title><link>https://news.google.com/rss/articles/abc</link><pubDate>Fri, 27 Nov 2026 00:00:00 GMT</pubDate><source url="https://cloud.google.com/">Google Cloud</source><description>News description</description></item></channel></rss>`;
  const parsed = parseGoogleNewsRss(xml);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].publisher, "Google Cloud");
  assert.equal(parsed[0].sourceType, "google_news");
  assert.equal(parsed[0].verificationStatus, "aggregator_discovery");
});

test("agent awaits background research and does not expose internal tool trace", async () => {
  const result = await answerQuestion({ question: "Has Google announced new Arcade swag today?", history: [], timezone: "Asia/Kolkata" }, {
    now: new Date("2026-11-27T00:00:00Z"),
    providers: {
      searchWeb: async () => ({ status: "success", results: [{ title: "Search listing", url: "https://example.com/search", snippet: "A search lead" }] }),
      searchGoogleNews: async () => ({ status: "success", results: [{ title: "News lead", url: "https://news.google.com/rss/articles/abc", sourceType: "google_news", publisher: "Example publisher" }] }),
      searchCommunity: async () => ({ status: "success", results: [{ title: "Forum report", url: "https://discuss.google.dev/t/example/1", sourceType: "community" }] }),
      readIntelligenceFeed: async () => ({ status: "success", results: [] }),
      searchYouTube: async () => ({ status: "empty", results: [] })
    }
  });
  assert.equal(result.ok, true);
  assert.equal(typeof result.answer, "string");
  assert.ok(result.evidence.length >= 3);
  assert.equal("toolsSelected" in result, false);
  assert.equal("providerStatus" in result, false);
  assert.match(result.answer, /did not find a newly dated/i);
});


test("planner recognises Arcade swag questions without requiring the word Arcade", () => {
  const plan = buildResearchPlan("Has there been a new swag drop or special event?");
  assert.equal(plan.arcadeRelated, true);
  assert.equal(plan.useGoogleNews, true);
  assert.equal(plan.useCommunity, true);
  assert.equal(plan.useRepository, true);
});

test("programme-end target questions are classified as strategy", () => {
  assert.equal(classifyTask("How can I achieve 20 points till the programme end?"), "strategy");
});

test("repository official label rejects an untrusted host even with trusted metadata", () => {
  const result = normalizeEvidence([{
    title: "Spoofed source", url: "https://attacker.example/post/1",
    sourceType: "intelligence_repository", verificationStatus: "officially_announced",
    officialSourceMetadata: true
  }]);
  assert.notEqual(result[0].evidenceClass, "official_announcement");
});

test("research uses the supplied intelligence feed without another network fetch", async () => {
  const feedData = { schema_version: 1, initialization_status: "initialized", updated_at: "2026-11-27T00:00:00Z", knowledge_version: "approved-unit-v1", items: [{
    entity_type: "programme_event", entity_id: "programme_event:event-1", title: "Google Skills Arcade update",
    approved_at: "2026-11-27T00:00:00Z", approved_by: "owner_email_review", approval_method: "explicit_per_item_confirmation",
    record: {
      event_id: "event-1", title: "Google Skills Arcade update", published_at: "2026-11-26T00:00:00Z",
      verification_status: "officially_announced", human_review_required: false, notification_approved: true,
      source_urls: ["https://discuss.google.dev/t/example/123"],
      sources: [{ source_type: "google_cloud_community", source_domain: "discuss.google.dev",
        source_url: "https://discuss.google.dev/t/example/123", is_google_staff_author: true,
        publisher_authority: "google_staff_group", author_verification_method: "discourse_google_staff_group" }]
    }
  }] };
  const result = await answerQuestion({ question: "Any new Arcade event today?", timezone: "Asia/Kolkata" }, {
    now: new Date("2026-11-27T00:00:00Z"), feedData,
    providers: {
      searchWeb: async () => ({ results: [] }),
      searchGoogleNews: async () => ({ results: [] }),
      searchCommunity: async () => ({ results: [] }),
      searchYouTube: async () => ({ results: [] })
    }
  });
  assert.ok(result.evidence.some((item) => item.evidenceClass === "official_announcement"));
  assert.equal("providerStatus" in result, false);
});


test("ordinary questions do not run unrelated background research", async () => {
  let calls = 0;
  const empty = async () => { calls++; return { status: "success", results: [] }; };
  const result = await answerQuestion({ question: "How does photosynthesis work?", history: [], timezone: "Asia/Kolkata" }, {
    now: new Date("2026-11-27T00:00:00Z"),
    providers: { searchWeb: empty, searchGoogleNews: empty, searchCommunity: empty, readIntelligenceFeed: empty, searchYouTube: empty }
  });
  assert.equal(result.requiresResearch, false);
  assert.equal(result.showSources, false);
  assert.equal(result.evidence.length, 0);
  assert.equal(result.answer, "");
  assert.equal(calls, 0, "no search provider should run for an ordinary question");
});

test("explicit research requests with no matching search result give a specific no-match response", async () => {
  const result = await answerQuestion({ question: "Search the web for the history of an obscure fictional telescope model ZQ-991.", history: [], timezone: "Asia/Kolkata" }, {
    now: new Date("2026-11-27T00:00:00Z"),
    providers: {
      searchWeb: async () => ({ status: "success", results: [{ title: "Unrelated gardening guide", url: "https://example.org/gardening", snippet: "A guide to growing tomatoes." }] }),
      searchGoogleNews: async () => ({ results: [] }),
      searchCommunity: async () => ({ results: [] }),
      readIntelligenceFeed: async () => ({ results: [] }),
      searchYouTube: async () => ({ results: [] })
    }
  });
  assert.match(result.answer, /did not closely match the main terms/i);
  assert.match(result.answer, /specific name, product, place, date/i);
  assert.doesNotMatch(result.answer, /current estimate is .* Arcade points/i);
});
