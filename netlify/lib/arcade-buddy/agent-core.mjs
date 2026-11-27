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

function buildAnswer(question, evidence, strategy, now, timeZone, isArcade) {
  const lines = [];
  lines.push("Research completed for: “" + question.slice(0, 240) + "”");
  lines.push("Date checked: " + formatDate(now.toISOString(), timeZone) + ".");

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
  const other = evidence.filter((item) => ["unverified_search_result", "official_channel_metadata"].includes(item.evidenceClass));

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
    if (googlePublisher.length) lines.push("Google-published pages found: " + googlePublisher.length + ". Check the linked page for the exact programme details and current dates.");
  } else if (evidence.length) {
    lines.push("I found " + evidence.length + " relevant public source(s). The strongest matches are listed below and linked separately.");
    evidence.slice(0, 4).forEach((item) => lines.push(describeEvidence(item) + (item.snippet ? " " + item.snippet.slice(0, 220) : "")));
  } else {
    lines.push("I could not retrieve relevant source results for this request. Search feeds may be temporarily unavailable or may not index the topic. I will not guess an answer.");
  }

  if (evidence.some((item) => item.evidenceClass === "news_discovery" || item.evidenceClass === "unverified_search_result")) {
    lines.push("Verification note: search listings and news aggregators are discovery leads. A claim is not treated as official unless it meets the repository's trusted-source verification rule.");
  }
  if (strategy && strategy.status !== "route_found" && strategy.status !== "target_reached") {
    lines.push("A personal route requires the calculator to provide the actual remaining opportunities with verified point values and eligibility.");
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

  const plan = buildResearchPlan(question);
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

  const jobs = [providers.searchWeb(safeQueries, { fetchImpl })];
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
  const answer = buildAnswer(question, evidence, strategy, now, timeZone, plan.arcadeRelated);

  return {
    ok: true,
    agent: "Arcade Buddy",
    version: "0.2.0",
    answer,
    evidence: evidence.map(({ title, url, label, evidenceClass, publishedAt, publisher, verificationStatus }) => ({
      title, url, label, evidenceClass, publishedAt, publisher, verificationStatus
    })),
    strategy
  };
}
