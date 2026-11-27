import { generateAnswer, isConfigured } from "./gemini-provider.mjs";

const SYSTEM_INSTRUCTION = `You are Arcade Buddy, the AI assistant built into the Arcade Journey Tracker web app.

IDENTITY AND SPECIALIZATION
You specialize in the Google Skills Arcade programme: Arcade points, game badges, skill badges,
special events, facilitator programmes, monthly Arcade activity, swag, and programme rules. You
can also answer ordinary general-knowledge questions, but your strongest expertise is Arcade.

BEHAVIOUR
- Be helpful, accurate, clear, and practical. Prefer short, well-structured answers over long ones.
- Answer only what the user asked. Do not append an unrelated update roundup, news digest,
  suggested links, source list, generic disclaimer, or promotional footer.
- Do not add current programme updates unless the user's question asks for updates or the answer
  genuinely depends on current programme information.
- For greetings and ordinary general questions, respond naturally and do not force Arcade content.
- Do not begin answers with a search-status sentence such as "Checked today's date".
- Use the dashboard data and deterministic plan you are given instead of asking the user to repeat
  information the app already has.
- Use the research evidence you are given to answer questions about current events, announcements,
  games, or deadlines. Number citations like [1], [2] only when you actually rely on evidence.
- When the question does not need research, do not mention sources or links.
- Distinguish confirmed official information from community reports or unverified claims. If the
  evidence says something is a rumour, community report, or unverified, say so plainly.
- If the evidence provided does not cover what is needed, or is empty, say that clearly instead of
  inventing a game, badge, deadline, point value, swag item, or source. Never fabricate a citation.
- Never claim you performed a web search beyond what the evidence list already contains.
- Never change or imply you changed the user's saved points, badges, or settings — you can only
  recommend actions; the user applies any change themselves inside the app.
- Keep responses age-appropriate and do not help with anything dangerous, illegal, or harmful.`;

function formatEvidenceBlock(evidence) {
  if (!Array.isArray(evidence) || !evidence.length) {
    return "No research evidence was retrieved for this turn.";
  }
  return evidence.slice(0, 12).map((item, index) => {
    const lines = [
      "[" + (index + 1) + "] " + (item.title || "Untitled source"),
      item.url ? "URL: " + item.url : null,
      item.publishedAt ? "Published: " + item.publishedAt : null,
      item.publisher ? "Publisher: " + item.publisher : null,
      "Classification: " + (item.evidenceClass || item.verificationStatus || "unclassified"),
      item.label ? "Label: " + item.label : null
    ].filter(Boolean);
    return lines.join("\n");
  }).join("\n\n");
}

function formatDashboardBlock(calculator) {
  if (!calculator) return "No dashboard/calculator data was supplied for this turn.";
  try {
    return JSON.stringify(calculator).slice(0, 4000);
  } catch {
    return "Dashboard data could not be serialised.";
  }
}

function formatHistoryBlock(history) {
  const turns = Array.isArray(history) ? history.slice(-6) : [];
  if (!turns.length) return "No prior turns in this conversation.";
  return turns.map((item) => (item.role === "assistant" ? "Arcade Buddy: " : "User: ") + item.content).join("\n");
}

// Produces a final, cited natural-language answer from evidence that was
// already retrieved by the existing deterministic research providers
// (searchWeb / searchGoogleNews / searchCommunity / readIntelligenceFeed /
// searchYouTube in providers.mjs) and the existing deterministic strategy
// calculation (strategy.mjs). This function adds real-model reasoning on
// top of real, already-verified retrieval — it does not invent its own
// search results.
export async function generateGeminiAnswer({ question, history, evidence, strategy, calculator, timeZone, researchRequested = false }, options = {}) {
  const env = options.env || process.env;
  if (!isConfigured(env)) {
    return { ok: false, reason: "not_configured" };
  }
  const userText = [
    "Current time zone: " + (timeZone || "Asia/Kolkata") + ".",
    "Conversation so far:\n" + formatHistoryBlock(history),
    "Latest user question: " + question,
    "Live research requested for this turn: " + (researchRequested ? "yes" : "no") + ".",
    "Dashboard/calculator context (JSON, already computed by the app, trust these numbers):\n" + formatDashboardBlock(calculator),
    strategy
      ? "Deterministic planner output (already calculated from the dashboard; restate it, do not contradict it):\n" + JSON.stringify(strategy).slice(0, 2000)
      : "No deterministic plan was computed this turn (the dashboard did not include enough verified opportunity data, or this question did not need one).",
    "Research evidence retrieved for this turn:\n" + formatEvidenceBlock(evidence),
    "Now answer the user's latest question directly and stay within its scope. Use the dashboard data, deterministic plan, and " +
      "evidence above, plus ordinary general knowledge for non-Arcade questions. Do not append unrelated updates, news, or links. Cite evidence items " +
      "as [1], [2] etc. when you rely on them. If something needed to answer is missing from the " +
      "evidence, say so instead of guessing."
  ].join("\n\n");

  const result = await generateAnswer({
    systemInstruction: SYSTEM_INSTRUCTION,
    userText,
    useGoogleSearch: researchRequested === true
  }, options);
  if (!result.ok) return result;
  return { ok: true, text: result.text, model: result.model, sources: result.sources || [], groundingUsed: result.groundingUsed === true };
}
