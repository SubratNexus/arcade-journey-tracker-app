# Arcade Journey Tracker v8.3.0 — built-in build 813

## Arcade Intelligence

- Added a Developer Mode tab for connecting and monitoring an external discovery catalogue.
- Added a public raw-GitHub JSON feed reader with strict URL validation, a 12-hour browser cache and background refresh.
- Added safe feed validation: only rows marked `verified: true`, `category: skill`, and `status: active` can be merged as externally discovered Skill Badges.
- Added externally verified game-title keywords to the Game Badge matching rules.
- The external catalogue never overrides an existing manually curated catalogue entry.
- Added a server-side, owner-authenticated setting to save the public feed URL in existing community storage.
- Added the raw GitHub host to the site's `connect-src` Content Security Policy so the browser can fetch the feed.

## External scheduled discovery worker

- Added a separate GitHub Actions worker, scheduled once daily at 07:37 UTC (13:07 IST), with a manual run option.
- The worker checks public allowlisted Google Skills hosts, robots rules, sitemaps and relevant public pages.
- Added request pacing, crawl/page/image/download caps, timeouts and image SHA-256 fingerprints.
- Added Tesseract OCR and conservative classification based on explicit visible `SKILL BADGE`, `ARCADE GAME`/`GAME BADGE`, and `COMPLETION BADGE` labels.
- Uncertain detections remain in the candidate review data; special +2 is never inferred.
- No user profiles are crawled; no generative AI API, API key or paid server is required.

## Existing v8.2.0 features retained

- The two screenshot-referenced badges remain in the manually curated Skill Badge catalogue.
- Automatic special-game inference remains disabled; special +2 is manual-only.
- Paste Profile Text remains removed.
- Personal corrections and keywords persist in the same browser until Clear My Data.
- Manual bonus-event points remain available.
- Developer Mode still manages skill badge titles and keywords.
- Refresh/image scanning remains background-oriented.
- ZIP hot-update extraction fix remains included.

## Important boundaries

- The worker is not a permanent server; it runs once per scheduled workflow and can be run manually.
- GitHub scheduled workflows can be delayed, and GitHub can disable schedules in public repositories after 60 days without activity.
- Google may use dynamic pages, block automated access, or change page markup. The worker respects robots.txt and does not bypass sign-in or access restrictions.
- A successful run is not proof that every badge was found. Only explicit labels are accepted into the verified feed.
- The public GitHub repository reveals the agent source and public catalogue under its owner's GitHub username. Do not place personal data, credentials or secrets in that repository.
- The website's existing Netlify functions continue to use the existing Netlify service. This release moves scheduled crawling/OCR away from Netlify; it does not remove all Netlify usage.

## Validation performed

- `node tools/build.js` completed successfully and syntax-checked the seven Netlify Functions.
- Python syntax compilation completed successfully for `agent/discover.py`.
- Additional classification tests and ZIP-integrity checks are recorded in the handoff response.
- No live crawl or production Netlify deployment was performed from this workspace.
