const TRUSTED_GOOGLE_STAFF_METHOD = "discourse_google_staff_group";
const GOOGLE_PUBLISHER_HOSTS = new Set([
  "skills.google", "www.skills.google", "cloud.google.com", "developers.google.com",
  "discuss.google.dev", "cloudskillsboost.google", "www.cloudskillsboost.google"
]);

function officialRepositoryRecord(item) {
  let hostname = "";
  try { hostname = new URL(item.url).hostname.toLowerCase(); } catch { return false; }
  return item.sourceType === "intelligence_repository" &&
    item.verificationStatus === "officially_announced" &&
    item.officialSourceMetadata === true &&
    hostname === "discuss.google.dev";
}

export function classifyEvidence(item = {}) {
  if (officialRepositoryRecord(item)) {
    return {
      evidenceClass: "official_announcement",
      label: "Official Google Community source (repository-verified)",
      verificationNote: "The intelligence repository records an exact Google Staff group marker on the original announcement author."
    };
  }
  if (item.sourceType === "community") {
    return {
      evidenceClass: "community_report",
      label: "Community report",
      verificationNote: "Community discussion is a lead, not confirmation of a Google programme rule."
    };
  }
  if (item.sourceType === "google_news") {
    return {
      evidenceClass: "news_discovery",
      label: "Google News discovery result",
      verificationNote: "Google News is an aggregator. The linked publisher page must be checked before treating the claim as confirmed."
    };
  }
  if (item.sourceType === "youtube") {
    return {
      evidenceClass: "official_channel_metadata",
      label: "Google-owned YouTube channel metadata",
      verificationNote: "Channel ownership does not by itself confirm a programme-specific announcement."
    };
  }
  if (item.sourceType === "intelligence_catalogue") {
    return {
      evidenceClass: "catalogue_evidence",
      label: "Badge catalogue record (repository-verified page evidence)",
      verificationNote: "The catalogue record is a research lead. It does not prove that an activity is currently available, that this user is eligible, or that it awards points."
    };
  }
  if (item.sourceType === "intelligence_change") {
    return {
      evidenceClass: "repository_observation",
      label: "Intelligence repository change record",
      verificationNote: "This records a detected catalogue or programme-feed change; check the linked original source for current details."
    };
  }

  let hostname = "";
  try { hostname = new URL(item.url).hostname.toLowerCase(); } catch { /* rejected later */ }
  if (GOOGLE_PUBLISHER_HOSTS.has(hostname)) {
    return {
      evidenceClass: "google_publisher_source",
      label: "Google-published source (claim not independently parsed)",
      verificationNote: "The publisher domain is Google-owned; this label does not independently validate every detail in the page."
    };
  }
  return {
    evidenceClass: "unverified_search_result",
    label: "Search result — unverified",
    verificationNote: "A search listing or snippet is a discovery lead, not proof."
  };
}

export function normalizeEvidence(items = []) {
  const seen = new Set();
  const normalized = [];
  for (const raw of Array.isArray(items) ? items : []) {
    if (!raw || !raw.url || !raw.title) continue;
    let parsed;
    try { parsed = new URL(raw.url); } catch { continue; }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) continue;
    const key = parsed.href.split("#")[0];
    if (seen.has(key)) continue;
    seen.add(key);

    const base = {
      url: key,
      sourceType: String(raw.sourceType || "web_search"),
      verificationStatus: String(raw.verificationStatus || "unverified"),
      officialSourceMetadata: raw.officialSourceMetadata === true
    };
    const classification = classifyEvidence({ ...base, url: key });
    normalized.push({
      title: String(raw.title).replace(/\s+/g, " ").slice(0, 220),
      url: key,
      snippet: String(raw.snippet || "").replace(/\s+/g, " ").slice(0, 520),
      sourceType: base.sourceType,
      evidenceClass: classification.evidenceClass,
      label: classification.label,
      verificationNote: classification.verificationNote,
      publishedAt: raw.publishedAt || null,
      publisher: raw.publisher || null,
      verificationStatus: base.verificationStatus
    });
  }

  const priority = {
    official_announcement: 0,
    google_publisher_source: 1,
    community_report: 2,
    news_discovery: 3,
    official_channel_metadata: 4,
    catalogue_evidence: 4,
    repository_observation: 4,
    unverified_search_result: 5
  };
  normalized.sort((a, b) => {
    const score = (priority[a.evidenceClass] ?? 9) - (priority[b.evidenceClass] ?? 9);
    if (score) return score;
    return String(b.publishedAt || "").localeCompare(String(a.publishedAt || ""));
  });
  return normalized.slice(0, 16);
}
