import test from "node:test";
import assert from "node:assert/strict";
import { generateAnswer, isConfigured, getModelName, providerStatus } from "../netlify/lib/arcade-buddy/gemini-provider.mjs";
import { generateGeminiAnswer } from "../netlify/lib/arcade-buddy/gemini-agent.mjs";
import * as intelligence from "../netlify/functions/intelligence.js";

function fakeGeminiFetch(text, status = 200) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(
      status >= 200 && status < 300
        ? { candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }] }
        : { error: { message: text } }
    )
  });
}

test("provider reports not configured when no API key is present", () => {
  const env = { AI_PROVIDER: "gemini" };
  assert.equal(isConfigured(env), false);
  assert.equal(providerStatus(env).configured, false);
});

test("provider reports configured once a key and provider are set", () => {
  const env = { AI_PROVIDER: "gemini", GEMINI_API_KEY: "test-key" };
  assert.equal(isConfigured(env), true);
  assert.equal(getModelName(env), "gemini-3.8-flash");
  assert.equal(getModelName({ ...env, GEMINI_MODEL: "gemini-3.6-flash" }), "gemini-3.6-flash");
});

test("AI_PROVIDER=none forces the deterministic fallback even with a key present", () => {
  assert.equal(isConfigured({ AI_PROVIDER: "none", GEMINI_API_KEY: "test-key" }), false);
});

test("generateAnswer returns not_configured without making a network call", async () => {
  let called = false;
  const result = await generateAnswer({ systemInstruction: "x", userText: "y" }, {
    env: {}, fetchImpl: async () => { called = true; }
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "not_configured");
  assert.equal(called, false);
});

test("generateAnswer parses a successful Gemini response", async () => {
  const result = await generateAnswer({ systemInstruction: "x", userText: "y" }, {
    env: { AI_PROVIDER: "gemini", GEMINI_API_KEY: "k" },
    fetchImpl: fakeGeminiFetch("You currently have 12 Arcade points. [1]")
  });
  assert.equal(result.ok, true);
  assert.match(result.text, /12 Arcade points/);
  assert.equal(result.model, "gemini-3.8-flash");
});

test("generateAnswer classifies an invalid API key response", async () => {
  const result = await generateAnswer({ systemInstruction: "x", userText: "y" }, {
    env: { AI_PROVIDER: "gemini", GEMINI_API_KEY: "bad-key" },
    fetchImpl: fakeGeminiFetch("API key not valid", 401)
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "invalid_key");
});

test("generateAnswer classifies a rate-limit response", async () => {
  const result = await generateAnswer({ systemInstruction: "x", userText: "y" }, {
    env: { AI_PROVIDER: "gemini", GEMINI_API_KEY: "k" },
    fetchImpl: fakeGeminiFetch("Quota exceeded", 429)
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "rate_limited");
});

test("generateAnswer reports a timeout without throwing", async () => {
  const result = await generateAnswer({ systemInstruction: "x", userText: "y" }, {
    env: { AI_PROVIDER: "gemini", GEMINI_API_KEY: "k" },
    fetchImpl: async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; }
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "timeout");
});

test("generateGeminiAnswer folds evidence and strategy into the prompt and returns cited text", async () => {
  let sentUserText = "";
  const result = await generateGeminiAnswer({
    question: "How can I earn 10 more points?",
    history: [{ role: "user", content: "How many points do I have?" }, { role: "assistant", content: "You have 12." }],
    evidence: [{ title: "Arcade Base Camp", url: "https://skills.google/arcade", evidenceClass: "official_announcement", publisher: "Google Skills" }],
    strategy: { status: "route_found", pointsNeeded: 10, plannedPoints: 10 },
    calculator: { totals: { currentPoints: 12 } },
    timeZone: "Asia/Kolkata"
  }, {
    env: { AI_PROVIDER: "gemini", GEMINI_API_KEY: "k" },
    fetchImpl: async (url, init) => { sentUserText = JSON.parse(init.body).contents[0].parts[0].text; return fakeGeminiFetch("Complete Arcade Base Camp to add 10 points [1].")(); }
  });
  assert.equal(result.ok, true);
  assert.match(result.text, /Arcade Base Camp/);
  assert.match(sentUserText, /Arcade Base Camp/);
  assert.match(sentUserText, /route_found/);
  assert.match(sentUserText, /currentPoints/);
});

test("generateGeminiAnswer returns not_configured cleanly when no key is set", async () => {
  const result = await generateGeminiAnswer({ question: "Hello", history: [], evidence: [], strategy: null, calculator: {}, timeZone: "Asia/Kolkata" }, { env: {} });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "not_configured");
});

test("intelligence.js health-check config helpers mirror the provider module", () => {
  const original = { ...process.env };
  delete process.env.AI_PROVIDER;
  delete process.env.GEMINI_API_KEY;
  assert.equal(intelligence._test.aiConfigured(), false);
  process.env.AI_PROVIDER = "gemini";
  process.env.GEMINI_API_KEY = "test-key";
  assert.equal(intelligence._test.aiConfigured(), true);
  assert.equal(intelligence._test.aiModelName(), "gemini-3.8-flash");
  process.env = original;
});
