# Arcade Buddy background research integration

Arcade Buddy now uses the existing robot already embedded in `index.html` and `app-builtin.html`. No second widget is added.

The browser posts a question, a small in-memory conversation history, and the calculator's existing whitelisted summary to `/api/intelligence`. The existing function keeps its rate limit, profile sanitisation, public-feed cache, and owner-only approved-email digest. It then dynamically imports the research agent and waits for relevant public source checks to finish.

The research agent performs the following in the background:

1. Classifies the question and selects relevant source adapters.
2. Always attempts broad public web discovery.
3. Adds Google News RSS for current/news questions.
4. Adds Google Developer Community and the intelligence repository for Arcade-related questions.
5. Adds configured Google Cloud YouTube Atom feeds for video or matching Arcade announcement questions.
6. Normalises HTTPS evidence, checks publication dates, and keeps official/community/news/search evidence categories separate.
7. Returns only the completed answer and source references.

No intermediate steps or private reasoning are sent to the chat. The robot shows only its final response and clickable sources. A disabled Send button prevents duplicate concurrent requests, but no search status text is shown.

## Provider boundaries

Google News RSS is a discovery channel, not the complete Google Search index and not a guaranteed developer API. Google's Custom Search JSON API is not open to new customers. Broad search uses a best-effort public Bing RSS adapter. These public endpoints can rate-limit or change. This free implementation is therefore best-effort and is not unlimited or guaranteed real-time search.

YouTube adapter reads public channel Atom metadata only. It does not fetch transcripts, captions, private content, or user account data.

## Personal planning and privacy

The original deterministic calculator planner remains in place for individual points, tier, checklist, time-availability and next-step questions. It uses the existing safe `sanitiseProfile` fields. The external research adapters receive only the redacted question text and limited follow-up context. Profile name, email, public profile URL, credentials, and session tokens are not sent to search providers.

The agent's optional subset-sum route calculator is only used when explicit structured opportunity objects are supplied and each opportunity passes verification, eligibility, date, completion and Google-host allowlist checks. The current app does not yet supply a complete structured opportunity feed, so it will not invent a personal list of guaranteed opportunities.

## Checks

Run `npm run check` and `npm test`. The test suite covers the existing calculator, existing intelligence protections, planner selection, search redaction, evidence classification, strategy rules, and hidden background answer flow.
