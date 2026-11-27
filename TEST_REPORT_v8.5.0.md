# v8.5.0 validation report

Automated local checks performed on the packaged source:

- Both HTML entry points contain app build 815; `netlify/functions/release.js` uses baseline 815.
- The build script parses inline JavaScript and syntax-checks every Netlify Function.
- Smoke tests assert the logout/data-clear separation, manual point and Facilitator source summary, Home section ordering, inactive AI assistant placeholder, absence of Gemini image-reader UI, and force-refresh cache bypass/watchdog text.
- Shared Skill Badge catalogue endpoint and retire/restore persistence assertions from v8.4.0 remain in place.
- Hot Update paste editor and upload methods remain present.

These are static/local checks. No live Netlify deployment, browser interaction test, or live Google Skills profile refresh has been performed. Verify the behaviour on the deployed site after the full project deployment.
