import { buildResearchPlan, redactSearchText, resolveFollowUp } from "./planner.mjs";
import { normalizeEvidence } from "./evidence.mjs";
import { calculateStrategy } from "./strategy.mjs";
import { searchWeb, searchGoogleNews, searchCommunity, readIntelligenceFeed, searchYouTube } from "./providers.mjs";

function formatDate(value, timeZone) {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone }).format(date);
}

function daysOld(value, now) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return Math.floor((now.getTime() - date.getTime()) / 86400000);
}

function describeEvidence(item) {
  const date = item.publishedAt ? " (published " + item.publishedAt + ")" : "";
  return item.title + date + ". " + item.label + ".";
}

const SEARCH_STOP_WORDS = new Set([
  "about", "after", "again", "also", "and", "are", "can", "could", "does", "for",
  "from", "give", "have", "help", "how", "into", "is", "its", "latest", "make",
  "me", "more", "most", "new", "please", "show", "tell", "that", "the", "their",
  "this", "those", "today", "what", "when", "where", "which", "who", "why", "with",
  "would", "you", "your"
]);

function rankSearchEvidence(question, evidence) {
  const terms = [...new Set((String(question).toLowerCase().match(/[a-z0-9][a-z0-9+#.-]{1,}/g) || [])
    .filter((term) => term.length > 2 && !SEARCH_STOP_WORDS.has(term)))].slice(0, 12);
  return evidence.map((item, index) => {
    const title = String(item.title || "").toLowerCase();
    const snippet = String(item.snippet || "").toLowerCase();
    const score = terms.reduce((total, term) => total + (title.includes(term) ? 3 : 0) + (snippet.includes(term) ? 1 : 0), 0);
    return { item, index, score };
  }).sort((a, b) => b.score - a.score || a.index - b.index);
}

function buildAnswer(question, evidence, strategy, now, timeZone, isArcade) {
  const lines = [];
  lines.push("Checked " + formatDate(now.toISOString(), timeZone) + ".");

  if (strategy) {
    lines.push(strategy.message);
    if (strategy.status === "route_found") {
      lines.push("You need " + strategy.pointsNeeded + " more points. The verified route adds " + strategy.plannedPoints + " points, projecting " + strategy.projectedPoints + " total.");
      lines.push("Suggested activities: " + strategy.route.map((item, index) => (index + 1) + ". " + item.title + " (" + item.points + " points)").join("; ") + ".");
      if (strategy.daysRemaining !== null) lines.push("Days remaining to the verified programme end date: " + strategy.daysRemaining + ".");
    } else if (strategy.pointsNeeded !== undefined) {
      lines.push("Points still needed: " + strategy.pointsNeeded + ".");
    }
  }

  const official = evidence.filter((item) => item.evidenceClass === "official_announcement");
  const recentOfficial = official.filter((item) => {
    const age = daysOld(item.publishedAt, now);
    return age !== null && age >= 0 && age <= 30;
  });
  const community = evidence.filter((item) => item.evidenceClass === "community_report");
  const news = evidence.filter((item) => item.evidenceClass === "news_discovery");
  const googlePublisher = evidence.filter((item) => item.evidenceClass === "google_publisher_source");
  const isAnnouncementQuestion = /(swag|event|announcement|drop|special|new|latest|active|running|today)/i.test(question);

  if (isArcade && isAnnouncementQuestion) {
    if (recentOfficial.length) {
      lines.push("Confirmed official-source findings published within the last 30 days: " + recentOfficial.length + ".");
      recentOfficial.slice(0, 3).forEach((item) => lines.push(describeEvidence(item)));
    } else {
      lines.push("I did not find a newly dated, repository-verified official announcement in the sources returned for this check. That does not prove that no announcement exists.");
    }
    if (community.length) lines.push("Community reports found: " + community.length + ". These are reports, not official confirmation.");
    if (news.length) lines.push("Google News discovery leads found: " + news.length + ". These are aggregator results and need confirmation from their original publisher.");
    if (googlePublisher.length) lines.push("Google-published pages found: " + googlePublisher.length + ". Open the linked page for exact programme details and current dates.");
  } else {
    const ranked = rankSearchEvidence(question, evidence);
    const relevant = ranked.filter((entry) => entry.score > 0).slice(0, 3);
    if (relevant.length) {
      lines.push(isArcade ? "Here are the most relevant Arcade sources I found:" : "Here are the most relevant public search findings:");
      relevant.forEach(({ item }, index) => {
        const snippet = String(item.snippet || "").trim();
        lines.push((index + 1) + ". " + describeEvidence(item) + (snippet ? "\n   " + snippet.slice(0, 320) : ""));
      });
      lines.push("These are search-result excerpts, not a full verification of every page. Open the source links to check the complete details.");
    } else if (evidence.length) {
      lines.push("The search returned pages, but their titles and excerpts did not closely match the main terms in your question. I don't want to present unrelated results as an answer.");
      lines.push("Try adding a specific name, product, place, date, or a shorter phrase.");
    } else if (!isArcade) {
      lines.push("I couldn't find useful public search results for this question. The search feed may be temporarily unavailable or may not cover the topic.");
      lines.push("Try a shorter query or include a specific name, place, or date. I won't invent an answer when there is no supporting source.");
    } else {
      lines.push("I couldn't retrieve a useful matching source for this Arcade question. The public feeds may be temporarily unavailable or may not index this topic.");
    }
  }

  if (evidence.some((item) => item.evidenceClass === "news_discovery" || item.evidenceClass === "unverified_search_result")) {
    lines.push("Verification note: search listings and news aggregators are discovery leads. Treat claims as confirmed only after checking the original publisher or an approved official source.");
  }
  if (strategy && strategy.status !== "route_found" && strategy.status !== "target_reached") {
    lines.push("A personal route requires the calculator to provide actual remaining opportunities with verified point values and eligibility.");
  }
  return lines.join("\n\n");
}

function validTimeZone(value) {
  const requested = String(value || "Asia/Kolkata");
  try { new Intl.DateTimeFormat("en", { timeZone: requested }); return requested; }
  catch { return "Asia/Kolkata"; }
}

export async function answerQuestion(input = {}, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const timeZone = validTimeZone(input.timezone);
  const history = Array.isArray(input.history) ? input.history.slice(-8) : [];
  const question = resolveFollowUp(input.question, history);
  if (!question || question.length > 1200) throw new Error("Please enter a question of up to 1,200 characters.");

  const plan = buildResearchPlan(question, input.taskPlan || null);
  const safeQueries = plan.queries.map(redactSearchText);
  const safeCommunityQuery = redactSearchText(question);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const providers = {
    searchWeb: options.providers?.searchWeb || searchWeb,
    searchGoogleNews: options.providers?.searchGoogleNews || searchGoogleNews,
    searchCommunity: options.providers?.searchCommunity || searchCommunity,
    readIntelligenceFeed: options.providers?.readIntelligenceFeed || readIntelligenceFeed,
    searchYouTube: options.providers?.searchYouTube || searchYouTube
  };

  const jobs = [];
  if (plan.useWebSearch) jobs.push(providers.searchWeb(safeQueries, { fetchImpl }));
  if (plan.useGoogleNews) jobs.push(providers.searchGoogleNews(safeQueries, { fetchImpl }));
  if (plan.useCommunity) jobs.push(providers.searchCommunity(safeCommunityQuery, { fetchImpl }));
  if (plan.useRepository) jobs.push(providers.readIntelligenceFeed({ fetchImpl, feedData: options.feedData || null }));
  if (plan.useYouTube) jobs.push(providers.searchYouTube({ fetchImpl }));

  // All research providers are awaited concurrently. No intermediate progress or private reasoning is returned to the browser.
  const settled = await Promise.allSettled(jobs);
  const rawEvidence = settled.flatMap((item) => item.status === "fulfilled" && Array.isArray(item.value?.results) ? item.value.results : []);
  const evidence = normalizeEvidence(rawEvidence);
  const hasExplicitOpportunities = Array.isArray(input.dashboard?.opportunities);
  const strategy = plan.useDashboardCalculation && hasExplicitOpportunities ? calculateStrategy(input.dashboard || {}, now) : null;
  const answer = plan.requiresResearch
    ? buildAnswer(question, evidence, strategy, now, timeZone, plan.arcadeRelated)
    : "";

  return {
    ok: true,
    agent: "Arcade Buddy",
    version: "0.2.0",
    answer,
    evidence: evidence.map(({ title, url, label, evidenceClass, publishedAt, publisher, verificationStatus }) => ({
      title, url, label, evidenceClass, publishedAt, publisher, verificationStatus
    })),
    strategy,
    requiresResearch: plan.requiresResearch,
    showSources: plan.requiresResearch && evidence.length > 0
  };
}
