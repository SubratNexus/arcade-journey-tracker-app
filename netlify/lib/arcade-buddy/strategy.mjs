const ALLOWED_SOURCE_HOSTS = new Set([
  "skills.google", "www.skills.google", "discuss.google.dev", "cloud.google.com",
  "www.cloudskillsboost.google", "cloudskillsboost.google"
]);

function parseDate(value, endOfDay = false) {
  if (!value) return null;
  const raw = String(value);
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw) && endOfDay
    ? raw + "T23:59:59.999Z"
    : raw;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function safeOpportunity(item, now) {
  if (!item || typeof item !== "object") return false;
  if (item.verificationStatus !== "verified" || item.eligible !== true || item.completed === true) return false;
  if (!Number.isInteger(item.points) || item.points < 1 || item.points > 100) return false;
  let source;
  try { source = new URL(item.sourceUrl); } catch { return false; }
  if (source.protocol !== "https:" || !ALLOWED_SOURCE_HOSTS.has(source.hostname) || source.username || source.password) return false;
  const start = parseDate(item.availableFrom, false);
  const end = parseDate(item.availableUntil, true);
  if (start && start > now) return false;
  if (end && end < now) return false;
  return true;
}

export function calculateStrategy(dashboard = {}, now = new Date()) {
  const currentPoints = Number.isInteger(dashboard.currentPoints) ? dashboard.currentPoints : null;
  const targetPoints = Number.isInteger(dashboard.targetPoints) ? dashboard.targetPoints : null;
  if (currentPoints === null || targetPoints === null || currentPoints < 0 || targetPoints < 0 || currentPoints > 100000 || targetPoints > 100000) {
    return { status: "needs_dashboard_data", message: "I need valid current points and a target from the calculator dashboard before calculating a personal route." };
  }

  const pointsNeeded = Math.max(0, targetPoints - currentPoints);
  const programmeEnd = dashboard.programmeEndDateVerified === true
    ? parseDate(dashboard.programmeEndDate, true)
    : null;
  const daysRemaining = programmeEnd ? Math.max(0, Math.ceil((programmeEnd.getTime() - now.getTime()) / 86400000)) : null;
  if (pointsNeeded === 0) {
    return { status: "target_reached", currentPoints, targetPoints, pointsNeeded: 0, daysRemaining, route: [], message: "The supplied dashboard points already meet the target." };
  }

  const raw = Array.isArray(dashboard.opportunities) ? dashboard.opportunities.slice(0, 100) : [];
  const opportunities = raw.filter((item) => safeOpportunity(item, now)).map((item, index) => ({
    id: String(item.id || item.title || "opportunity-" + index),
    title: String(item.title || "Verified opportunity").slice(0, 140),
    points: item.points,
    availableUntil: item.availableUntil || null,
    sourceUrl: item.sourceUrl
  }));

  // 0/1 subset-sum: each activity can be selected at most once.
  const maxScore = Math.min(2000, opportunities.reduce((sum, item) => sum + item.points, 0));
  if (maxScore < pointsNeeded) {
    return {
      status: opportunities.length ? "insufficient_verified_opportunities" : "no_verified_opportunities",
      currentPoints, targetPoints, pointsNeeded,
      verifiedOpportunities: opportunities.length,
      verifiedPointsAvailable: opportunities.reduce((sum, item) => sum + item.points, 0),
      daysRemaining, route: [],
      message: opportunities.length
        ? "The verified, currently eligible opportunities supplied do not add up to the points needed."
        : "No currently eligible opportunities with verified point values were supplied. I will not count rumours or invent point values."
    };
  }

  const dp = Array(maxScore + 1).fill(null);
  dp[0] = [];
  for (const item of opportunities) {
    for (let score = maxScore; score >= item.points; score -= 1) {
      const previous = dp[score - item.points];
      if (!previous) continue;
      const candidate = [...previous, item];
      if (!dp[score] || candidate.length < dp[score].length) dp[score] = candidate;
    }
  }
  let chosenScore = -1;
  let chosen = null;
  for (let score = pointsNeeded; score <= maxScore; score += 1) {
    if (!dp[score]) continue;
    if (!chosen || dp[score].length < chosen.length || (dp[score].length === chosen.length && score < chosenScore)) {
      chosenScore = score;
      chosen = dp[score];
    }
  }

  if (!chosen) {
    return {
      status: "no_combination_found", currentPoints, targetPoints, pointsNeeded,
      verifiedOpportunities: opportunities.length, daysRemaining, route: [],
      message: "The verified opportunities do not form a complete route within the calculator's safe planning limit."
    };
  }
  return {
    status: "route_found", currentPoints, targetPoints, pointsNeeded,
    plannedPoints: chosenScore, projectedPoints: currentPoints + chosenScore,
    daysRemaining, route: chosen,
    message: "This route uses only opportunities explicitly marked verified, eligible, incomplete and currently in date in the calculator data."
  };
}
