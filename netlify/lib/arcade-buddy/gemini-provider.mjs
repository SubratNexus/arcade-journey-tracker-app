// Server-side adapter for the Gemini API (generativelanguage.googleapis.com).
// This module never runs in the browser and never receives the key from the
// frontend — it reads it from Netlify environment variables only.
//
// Env vars (document these in the deployment README):
//   AI_PROVIDER     "gemini" (default) or "none" to force the deterministic
//                   fallback even when a key is present.
//   GEMINI_API_KEY  Required. From Google AI Studio (aistudio.google.com).
//   GEMINI_MODEL    Optional. Defaults to a current free-tier model. Google
//                   changes free-tier model availability over time, so this
//                   is intentionally overridable without a code change.

const DEFAULT_MODEL = "gemini-3.8-flash"; // free-tier text model as of Oct 2026 — override via GEMINI_MODEL if Google changes this.
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";

export function isConfigured(env = process.env) {
  const provider = String(env.AI_PROVIDER || "gemini").toLowerCase();
  return provider === "gemini" && !!env.GEMINI_API_KEY;
}

export function getModelName(env = process.env) {
  return String(env.GEMINI_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
}

export function providerStatus(env = process.env) {
  return {
    configured: isConfigured(env),
    provider: String(env.AI_PROVIDER || "gemini").toLowerCase(),
    model: getModelName(env),
    keyPresent: !!env.GEMINI_API_KEY
  };
}

// Calls Gemini with a plain system instruction + single user turn (no native
// function-calling): research is gathered by the existing deterministic
// providers first and handed to the model as context, see gemini-agent.mjs.
export async function generateAnswer({ systemInstruction, userText }, {
  fetchImpl = globalThis.fetch,
  env = process.env,
  timeoutMs = 9000
} = {}) {
  if (!isConfigured(env)) {
    return { ok: false, reason: "not_configured" };
  }
  const model = getModelName(env);
  const url = API_BASE + encodeURIComponent(model) + ":generateContent";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": env.GEMINI_API_KEY
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: "user", parts: [{ text: userText }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 900 }
      })
    });
    const raw = await response.text();
    if (!response.ok) {
      let message = "HTTP_" + response.status;
      try {
        const parsed = JSON.parse(raw);
        message = parsed?.error?.message || message;
      } catch { /* leave default message */ }
      const reason = response.status === 429 ? "rate_limited"
        : (response.status === 401 || response.status === 403) ? "invalid_key"
        : response.status >= 500 ? "provider_outage"
        : "provider_error";
      return { ok: false, reason, status: response.status, message: String(message).slice(0, 220) };
    }
    let data;
    try { data = JSON.parse(raw); } catch { return { ok: false, reason: "invalid_response" }; }
    const candidate = data?.candidates?.[0];
    const text = Array.isArray(candidate?.content?.parts)
      ? candidate.content.parts.map((part) => part.text || "").join("").trim()
      : "";
    if (!text) {
      const blocked = candidate?.finishReason === "SAFETY" || data?.promptFeedback?.blockReason;
      return { ok: false, reason: blocked ? "blocked" : "empty_response" };
    }
    return { ok: true, text, model, finishReason: candidate?.finishReason || null };
  } catch (error) {
    const aborted = error?.name === "AbortError";
    return { ok: false, reason: aborted ? "timeout" : "network_error", message: String(error?.message || "").slice(0, 160) };
  } finally {
    clearTimeout(timer);
  }
}
