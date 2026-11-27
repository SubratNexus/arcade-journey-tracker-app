# Arcade Journey Tracker v8.2.0 — build 812

## Badge classification

The screenshot-referenced `Build a Certification Study Guide: PCSE Exam Prep` and `Use Agent Skills with Multi-Agent Systems` titles are active Skill Badge catalogue records. Catalogue matches take priority over a weak negative modal signal. Both should be classified as Skill Badge and contribute 0.5 point each when exact-half scoring is selected.

Automatic special-game classification is disabled. The manual “Count as special game (2 pts)” correction remains available, so the category is never inferred automatically.

## Scanner

The profile parser collects badge card titles, date, visible/accessible card text, image alt/title text and image URLs from the pages returned by Google Skills. The browser's local image-shape scanner runs asynchronously; the optional Gemini service can inspect up to six badge images per request and return a category, confidence and short evidence. AI categories below 0.78 confidence are not used to override the local result. Explicit Skill Badge text, active catalogue records and the visitor's manual correction have higher priority.

The scanner can only inspect badge records and images that the public profile exposes and that the page fetch succeeds in reading. The fetch function probes profile pagination with bounded page/time limits; exceptionally long profiles or Google throttling can produce a partial scan. Use Sync again and check the scan result when Google is slow. No classifier can promise perfect accuracy.

## Saved choices and manual points

Manual category changes and personal keywords are stored in browser local storage and remain across profile changes and ordinary logouts. They clear only when the visitor chooses Clear My Data or clears browser storage. They are not synced to another device. Manual event points are keyed to the public profile ID, included in the matching calendar-year total, and clearly identified as user-entered rather than Google-verified.

## Developer workspace

Developer Mode now has Overview, Skill badges, Add Keyword, Hot updates and Community tabs. The owner can add catalogue titles/aliases, retire or restore titles, and save shared Game Badge and Skill Badge keyword lists through the community storage Function.

## Refresh and hot update

Profile image scanning no longer blocks the refresh completion path. The refresh action is guarded against concurrent runs and its busy state is reset in `finally`.

The hot-update panel accepts full project ZIPs up to 40 MB in the browser and extracts only the selected app HTML. The release service stores that HTML, validates the build, sends the owner an approval email and publishes only after approval. The server-side HTML limit is 1.5 MB. Functions, assets, redirects and environment variables still require a full Netlify deploy. The ZIP extractor’s loader-removal helper was tightened to remove only the dedicated standalone-homepage loader script; it leaves the calculator’s main script intact.

## Official Arcade program URL

The app now links to `https://go.skills.google/arcade`.

## Verification performed for this package

- `npm run build` passed: build markers match, inline JavaScript syntax checks pass, and all seven Netlify Function files pass Node syntax checks.
- The finished full-project ZIP passed its CRC/integrity test. The same browser-side ZIP extractor used by Developer Mode extracted the 206 KB built-in app and preserved the full calculator JavaScript. The standalone `index.html` test removed only its separate hot-update loader script.
- A mock hot-update integration test passed the upload, owner-email request, approval page, approval action, live release fetch and single-use approval-link checks for test build 813. The mock did not contact a real email provider or Netlify Blobs.
- No production deployment, live Google Skills profile scan, real Gemini request or Android-device browser session was performed in this environment. Confirm the deployed site using `/api/release?m=health` after the full Netlify deploy.
