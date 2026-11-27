const INTELLIGENCE_FEED_URL =
  "https://raw.githubusercontent.com/SubratNexus/arcade-intelligence-2.0/main/agent-data/public-feed.json";

const CHANNELS = [
  { name: "Google Cloud Tech", id: "UCJS9pqu9BzkAMNTmzNMNhvg" },
  { name: "Google Cloud", id: "UCTMRxtyHoE3LPcrl-kT4AQQ" }
];

const MAX_TEXT_CHARS = 500_000;

async function getText(url, {
  fetchImpl = globalThis.fetch,
  timeoutMs = 8500,
  maxChars = MAX_TEXT_CHARS,
  headers = {}
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers: { "User-Agent": "ArcadeBuddy/0.2 (+public research client)", ...headers }
    });
    if (!response.ok) throw new Error("HTTP_" + response.status);
    const declared = Number(response.headers?.get?.("content-length") || 0);
    if (declared > maxChars) throw new Error("RESPONSE_TOO_LARGE");
    const body = await response.text();
    if (body.length > maxChars) throw new Error("RESPONSE_TOO_LARGE");
    return body;
  } finally {
    clearTimeout(timer);
  }
}

function decodeXml(value = "") {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

function xmlTag(block, tag) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp("<" + escaped + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + escaped + ">", "i"));
  return match ? decodeXml(match[1]) : "";
}

function attrTag(block, tag, attribute) {
  const re = new RegExp("<" + tag + "\\b([^>]*)>([\\s\\S]*?)</" + tag + ">", "i");
  const match = String(block).match(re);
  if (!match) return { value: "", text: "" };
  const attr = match[1].match(new RegExp("\\b" + attribute + "=[\"']([^\"']*)[\"']", "i"));
  return { value: attr ? decodeXml(attr[1]) : "", text: decodeXml(match[2]) };
}

function safeHttps(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}

export function parseBingRss(xml = "") {
  const matches = String(xml).match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) || [];
  return matches.slice(0, 8).map((block) => ({
    title: xmlTag(block, "title"),
    url: safeHttps(xmlTag(block, "link")),
    snippet: xmlTag(block, "description"),
    publishedAt: xmlTag(block, "pubDate") || null,
    sourceType: "web_search",
    verificationStatus: "search_result"
  })).filter((item) => item.title && item.url);
}

export function parseGoogleNewsRss(xml = "") {
  const matches = String(xml).match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) || [];
  return matches.slice(0, 8).map((block) => {
    const source = attrTag(block, "source", "url");
    return {
      title: xmlTag(block, "title"),
      url: safeHttps(xmlTag(block, "link")),
      snippet: xmlTag(block, "description"),
      publishedAt: xmlTag(block, "pubDate") || null,
      publisher: source.text || null,
      publisherUrl: safeHttps(source.value) || null,
      sourceType: "google_news",
      verificationStatus: "aggregator_discovery"
    };
  }).filter((item) => item.title && item.url);
}

export async function searchWeb(queries = [], { fetchImpl = globalThis.fetch } = {}) {
  const results = [];
  const failures = [];
  for (const query of [...new Set(queries)].slice(0, 2)) {
    try {
      const url = new URL("https://www.bing.com/search");
      url.searchParams.set("format", "rss");
      url.searchParams.set("q", String(query).slice(0, 220));
      const xml = await getText(url.toString(), {
        fetchImpl, timeoutMs: 8500, maxChars: 250_000,
        headers: { Accept: "application/rss+xml, application/xml, text/xml" }
      });
      results.push(...parseBingRss(xml));
    } catch (error) {
      failures.push(String(error?.message || "SEARCH_UNAVAILABLE").slice(0, 100));
    }
  }
  return { results: results.slice(0, 12), status: results.length ? (failures.length ? "partial" : "success") : "unavailable", failures };
}

export async function searchGoogleNews(queries = [], { fetchImpl = globalThis.fetch } = {}) {
  const results = [];
  const failures = [];
  for (const query of [...new Set(queries)].slice(0, 2)) {
    try {
      const url = new URL("https://news.google.com/rss/search");
      url.searchParams.set("q", String(query).slice(0, 220));
      url.searchParams.set("hl", "en-IN");
      url.searchParams.set("gl", "IN");
      url.searchParams.set("ceid", "IN:en");
      const xml = await getText(url.toString(), {
        fetchImpl, timeoutMs: 8500, maxChars: 250_000,
        headers: { Accept: "application/rss+xml, application/xml, text/xml" }
      });
      results.push(...parseGoogleNewsRss(xml));
    } catch (error) {
      failures.push(String(error?.message || "GOOGLE_NEWS_UNAVAILABLE").slice(0, 100));
    }
  }
  return {
    results: results.slice(0, 12),
    status: results.length ? (failures.length ? "partial" : "success") : "unavailable",
    failures,
    limitation: "Google News RSS is a news-discovery feed, not the complete Google Search index or a guaranteed developer API."
  };
}

export async function searchCommunity(query = "", { fetchImpl = globalThis.fetch } = {}) {
  try {
    const url = new URL("https://discuss.google.dev/search.json");
    url.searchParams.set("q", String(query).slice(0, 220));
    const body = await getText(url.toString(), {
      fetchImpl, timeoutMs: 8500, maxChars: 300_000,
      headers: { Accept: "application/json" }
    });
    const data = JSON.parse(body);
    const topics = Array.isArray(data.topics) ? data.topics :
      Array.isArray(data.topic_list?.topics) ? data.topic_list.topics : [];
    const results = topics.slice(0, 7).map((topic) => {
      const id = Number(topic.id);
      const slug = String(topic.slug || "topic");
      return {
        title: String(topic.title || topic.fancy_title || "Google Developer Community topic"),
        url: Number.isInteger(id) && id > 0 ? "https://discuss.google.dev/t/" + encodeURIComponent(slug) + "/" + id : "https://discuss.google.dev/",
        snippet: String(topic.excerpt || topic.excerpt_text || topic.blurb || ""),
        publishedAt: topic.created_at || topic.last_posted_at || null,
        sourceType: "community",
        verificationStatus: "community_report"
      };
    });
    return { results, status: results.length ? "success" : "empty" };
  } catch (error) {
    return { results: [], status: "unavailable", failures: [String(error?.message || "COMMUNITY_SEARCH_UNAVAILABLE").slice(0, 100)] };
  }
}

export async function readIntelligenceFeed({ fetchImpl = globalThis.fetch, feedData = null } = {}) {
  try {
    let data = feedData;
    if (!data) {
      const body = await getText(INTELLIGENCE_FEED_URL, {
        fetchImpl, timeoutMs: 8500, maxChars: 500_000,
        headers: { Accept: "application/json" }
      });
      data = JSON.parse(body);
    }
    if (!data || !Array.isArray(data.programme_events)) throw new Error("UNSUPPORTED_INTELLIGENCE_FEED");
    const results = data.programme_events.slice(0, 100).map((event) => {
      const trustedSources = Array.isArray(event.sources) ? event.sources.filter((source) => {
        if (!source || source.source_type !== "google_cloud_community" ||
            source.source_domain !== "discuss.google.dev" ||
            source.is_google_staff_author !== true ||
            source.publisher_authority !== "google_staff_group" ||
            source.author_verification_method !== "discourse_google_staff_group") return false;
        try {
          const url = new URL(source.source_url);
          return url.protocol === "https:" && url.hostname === "discuss.google.dev" &&
            url.pathname.startsWith("/t/") && !url.username && !url.password;
        } catch { return false; }
      }) : [];
      const trustedUrl = trustedSources[0]?.source_url || "";
      const isOfficial = event.verification_status === "officially_announced" && !!trustedUrl;
      const rawUrls = Array.isArray(event.source_urls) ? event.source_urls : [];
      const urls = rawUrls.filter((value) => {
        try { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password; }
        catch { return false; }
      });
      const link = isOfficial ? trustedUrl : (urls[0] || "https://discuss.google.dev/c/google-cloud/cloud-announcements/172");
      return {
        title: String(event.title || "Arcade programme update"),
        url: link,
        snippet: [
          event.verification_explanation || "",
          Array.isArray(event.explicit_point_mentions) ? event.explicit_point_mentions.join("; ") : "",
          Array.isArray(event.tier_mentions) ? "Tier mentions: " + event.tier_mentions.join(", ") : "",
          event.human_review_required !== false ? "Human review is still pending; this is not a verified participant opportunity." : "",
          "Review: " + String(event.review_decision || "pending")
        ].filter(Boolean).join(" "),
        publishedAt: event.published_at || null,
        publisher: "Google Cloud Community",
        sourceType: "intelligence_repository",
        verificationStatus: isOfficial ? "officially_announced" : String(event.verification_status || "unverified"),
        officialSourceMetadata: isOfficial,
        humanReviewRequired: event.human_review_required !== false
      };
    });
    return { results, status: "success", generatedAt: data.generated_at || null };
  } catch (error) {
    return { results: [], status: "unavailable", failures: [String(error?.message || "INTELLIGENCE_FEED_UNAVAILABLE").slice(0, 100)] };
  }
}

function parseAtom(xml = "", channelName = "") {
  const entries = String(xml).match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  return entries.slice(0, 12).map((entry) => {
    const videoId = xmlTag(entry, "yt:videoId");
    const title = xmlTag(entry, "title");
    const publishedAt = xmlTag(entry, "published");
    const linkMatch = entry.match(/<link\b[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i);
    const url = linkMatch ? safeHttps(decodeXml(linkMatch[1])) : (videoId ? "https://www.youtube.com/watch?v=" + videoId : "");
    return { title, url, snippet: "Public Atom-feed metadata from " + channelName + ". Video captions and transcripts are not retrieved.", publishedAt, publisher: channelName, sourceType: "youtube", verificationStatus: "official_channel_coverage_unconfirmed" };
  }).filter((item) => item.title && item.url);
}

export async function searchYouTube({ fetchImpl = globalThis.fetch } = {}) {
  const results = [];
  const failures = [];
  for (const channel of CHANNELS) {
    try {
      const url = "https://www.youtube.com/feeds/videos.xml?channel_id=" + channel.id;
      const xml = await getText(url, { fetchImpl, timeoutMs: 8000, maxChars: 200_000, headers: { Accept: "application/atom+xml, application/xml, text/xml" } });
      const relevant = parseAtom(xml, channel.name).filter((item) => /(arcade|google skills|prize counter|swag|build-a-thon)/i.test(item.title));
      results.push(...relevant);
    } catch (error) {
      failures.push(channel.name + ": " + String(error?.message || "FEED_UNAVAILABLE").slice(0, 75));
    }
  }
  return { results: results.slice(0, 10), status: results.length ? (failures.length ? "partial" : "success") : (failures.length ? "unavailable" : "empty"), failures };
}
