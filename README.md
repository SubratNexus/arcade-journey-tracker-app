# Arcade Journey Tracker v8.6.2 + Arcade Buddy

This repository contains the **complete Arcade Journey Tracker calculator**, including its existing seasonal artwork, responsive dashboard, Developer Mode, Hot Update Manager, and the integrated Arcade Buddy robot. It is not an agent-only starter site.

## Arcade Buddy: hidden background research

When a user asks a question, the server decides which public sources are relevant, performs research in the background, verifies source classes, compares dates, and returns only the completed answer with clickable source links. The chat does not display internal planning or intermediate research steps. Recent chat context remains in page memory and is cleared when the page is refreshed.

Research adapters include:
- Broad public web discovery through a best-effort Bing RSS endpoint.
- Google News RSS for current events and announcement discovery.
- Public Google Developer Community discussions for Arcade-related questions.
- The existing `SubratNexus/arcade-intelligence-2.0` public evidence feed.
- Public metadata from configured Google Cloud YouTube channel Atom feeds when relevant (no captions or transcripts).

**Google Search limitation:** Google's Custom Search JSON API is closed to new customers. Google News RSS is useful for discovery but is not the complete Google Search index or a guaranteed developer API. This project therefore does not claim to provide full Google Search API access and requires no paid search API key. Google News and search results are leads, not proof of official programme announcements.

## Evidence and privacy rules

- Official Arcade announcement classification requires the exact public `google_staff` group marker recorded by the intelligence repository and a matching `https://discuss.google.dev/t/` source URL.
- Community reports, Google News results, YouTube channel metadata, and general search listings remain separate evidence classes.
- A Google-owned channel or Google News listing does not by itself prove eligibility, points, availability, or an official programme rule.
- Dashboard totals and badge lists are used only by the site's deterministic personal planner. External research adapters receive only a redacted question and limited conversation context—not profile links, names, email addresses, passwords, cookies, or Google session data.
- No external generative-AI model or paid API is called.
- Background research does not rewrite application code. Knowledge-feed updates remain separate from code changes; code changes must pass CI and be reviewed.

## Project structure

- `index.html`, `app-builtin.html`, `assets/`: complete calculator UI and seasonal image assets.
- `netlify/functions/`: existing calculator APIs and integrated `intelligence.js` endpoint.
- `netlify/lib/arcade-buddy/`: research planner, source adapters, evidence classifier, and deterministic strategy engine.
- `tools/`: full calculator and agent tests plus build validation.
- `.github/workflows/arcade-buddy-ci.yml`: no-secret GitHub Actions validation.
- `netlify.toml`: existing production build, redirects, and security headers; preserved.

## GitHub checks

Requires Node.js 20 or newer. No dependency installation or API key is required for the checks.

```sh
npm run check
npm test
```

GitHub Actions runs both automatically on pushes and pull requests to `main`.

## Netlify deployment order

Do not connect this repository to Netlify until the full repository has been uploaded and GitHub Actions passes. Then connect this repository to the existing `google-arcade-point-calculator` Netlify site, confirm the production branch is `main`, and create a Deploy Preview first. Only publish to production after the preview has been checked on mobile and desktop.

The project uses `node tools/build.js`, publishes `dist/`, and deploys functions from `netlify/functions/`. Keep `.netlify/`, `dist/`, `node_modules/`, and local secrets out of Git. Do not upload a ZIP file into the repository; extract it and upload the archive contents with their folder structure preserved.
