const ARCADE_TERMS = [
  "google skills arcade", "skills arcade", "arcade", "skill badge", "arcade points",
  "prize counter", "trooper", "ranger", "champion", "legend", "arcade game",
  "build-a-thon", "google cloud skills", "swag", "bonus points", "prize drop",
  "arcade event", "arcade programme", "arcade program", "special event"
];

const STRATEGY_TERMS = [
  "reach", "target", "earn", "points i need", "need to earn", "points needed",
  "remaining points", "make a plan", "points plan", "by the end", "get to",
  "achieve", "till the end", "until the end", "programme end", "program end",
  "by programme end", "by program end", "before the programme ends", "before the program ends"
];

const CURRENT_TERMS = [
  "today", "current", "currently", "right now", "now", "active", "running",
  "upcoming", "next", "deadline", "ends", "started", "special", "event",
  "announcement", "announced", "new", "latest", "recent", "swag", "drop", "prize"
];

export function isArcadeRelated(question = "") {
  const text = String(question).toLowerCase();
  return ARCADE_TERMS.some((term) => text.includes(term));
}

export function classifyTask(question = "") {
  const text = String(question).toLowerCase();
  if (STRATEGY_TERMS.some((term) => text.includes(term)) || /\b\d+\s*points?\b.*\b(before|by|reach|earn|till|until|achieve)\b/i.test(text)) return "strategy";
  if (/(badge|catalog|catalogue|checklist)/i.test(text)) return "badge_research";
  if (/(youtube|video|watch|channel|creator)/i.test(text)) return "video_research";
  if (/(calculator|profile link|update button|dashboard|not working|error)/i.test(text)) return "calculator_support";
  if (CURRENT_TERMS.some((term) => text.includes(term))) return "live_status";
  return "general_research";
}

export function requiresResearch(question = "", taskPlan = null) {
  const lower = String(question).toLowerCase();
  const hintedTools = Array.isArray(taskPlan?.tools) ? taskPlan.tools : [];
  const hintedResearch = hintedTools.some((tool) => ["web", "news", "community", "intelligence", "youtube"].includes(tool));
  const explicitResearch = /(\bsearch\b|\bresearch\b|\blook up\b|\bfind sources?\b|\bcitations?\b|\bverify\b|\bofficial (?:source|rules|announcement)\b|\blatest\b|\brecent\b|\btoday'?s? updates?\b|\bnews\b|\bannouncements?\b|\bswag\b|\bprize drop\b|\bnew (?:arcade )?(?:game|badge|event)\b|\bcurrently available\b|\bactive games?\b|\brunning events?\b|\bprogramme deadline\b|\bprogram deadline\b|\bend date\b|\bwhen does .* end\b|\bwhat is running\b|\bwhat'?s active\b)/i.test(lower);
  const deadlinePlanning = /(before|by|until|till).{0,45}(programme|program|season|deadline|end)/i.test(lower) ||
    /(programme|program|season).{0,35}(deadline|end date|ends)/i.test(lower);
  const currentOpportunityPlanning = /\b(available|open|eligible|opportunities|activities)\b/i.test(lower) &&
    /\b(earn|points|plan|games?|badges?)\b/i.test(lower);
  const arcadePlanIntent = isArcadeRelated(lower) &&
    /\b(plan|planner|personalised|personalized|recommend|suggest|what should i do|how can i|how do i|which should i)\b/i.test(lower) &&
    /\b(points?|earn|badges?|games?|activities|goal|target|programme|program|arcade)\b/i.test(lower);
  return hintedResearch || explicitResearch || deadlinePlanning || currentOpportunityPlanning || arcadePlanIntent;
}

export function buildResearchPlan(question = "", taskPlan = null) {
  const clean = String(question).trim();
  const lower = clean.toLowerCase();
  const researchRequired = requiresResearch(clean, taskPlan);
  const arcadeRelated = isArcadeRelated(clean) || /\b(swag|prize|bonus points|points|tier|badge|programme|program|event)\b/i.test(lower);
  const taskType = classifyTask(clean);
  const currentOrNews = CURRENT_TERMS.some((term) => lower.includes(term)) ||
    /(news|announcement|swag|event|release|launch|drop)/i.test(lower);
  const useCommunity = researchRequired && (/(community|forum|discussion|people saying|reports|rumou?r)/i.test(lower) || (arcadeRelated && currentOrNews));
  const useRepository = researchRequired && arcadeRelated;
  const useYouTube = researchRequired && (/(youtube|video|watch|channel|creator)/i.test(lower) ||
    (arcadeRelated && /(announcement|special|event|game|swag|build-a-thon|latest|new)/i.test(lower)));
  const hintedTools = Array.isArray(taskPlan?.tools) ? new Set(taskPlan.tools.filter((x) =>
    ["web", "news", "community", "intelligence", "youtube", "dashboard"].includes(x))) : new Set();
  const useGoogleNews = researchRequired && (currentOrNews || hintedTools.has("news"));
  const useDashboardCalculation = taskType === "strategy" || hintedTools.has("dashboard");
  const useCommunityWithHints = useCommunity || hintedTools.has("community");
  const useRepositoryWithHints = useRepository || hintedTools.has("intelligence");
  const useYouTubeWithHints = useYouTube || hintedTools.has("youtube");

  const queries = [clean];
  if (arcadeRelated && !/google skills arcade/i.test(clean)) queries.push("Google Skills Arcade " + clean);
  if (arcadeRelated && /(swag|event|announcement|drop|latest|new|special)/i.test(lower)) {
    queries.push('site:discuss.google.dev "Google Skills Arcade" ' + clean);
  }

  return {
    taskType,
    arcadeRelated,
    useCommunity: useCommunityWithHints,
    useRepository: useRepositoryWithHints,
    useYouTube: useYouTubeWithHints,
    useGoogleNews,
    useDashboardCalculation,
    requiresResearch: researchRequired,
    useWebSearch: researchRequired,
    queries: [...new Set(queries)].slice(0, 2)
  };
}

export function resolveFollowUp(question, history = []) {
  const current = String(question || "").trim();
  if (!current || !Array.isArray(history) || history.length === 0) return current;
  const previous = [...history].reverse().find((item) => item && item.role === "user" && item.content);
  if (!previous) return current;
  const short = current.split(/\s+/).length <= 5 ||
    /^(and|also|what about|how about|why|when|then|there|those|it|this|that)\b/i.test(current);
  return short ? String(previous.content).slice(0, 600) + "\nFollow-up: " + current : current;
}

export function redactSearchText(value = "") {
  return String(value)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email removed]")
    .replace(/\b(?:\+?\d[\d\s().-]{7,}\d)\b/g, "[phone removed]")
    .replace(/\b(?:password|passcode|api[_ -]?key|token|secret)\s*[:=]\s*\S+/gi, "[secret removed]")
    .replace(/https?:\/\/[^\s]+/gi, "[url removed]")
    .slice(0, 900);
}
