# Developer guide — Arcade Tracker v8.6.1

## Arcade Buddy
The dashboard's lower-left robot button opens Arcade Buddy. The UI is shared by `index.html` and `app-builtin.html`. It reads the loaded profile state, selected target, completed badge list, unfinished skill checklist, weekly time and preferred focus, then posts only whitelisted planning fields to `/api/intelligence`. Profile URL, account display name, email and Google login credentials are not included.

The Netlify Function fetches the read-only public feed from `SubratNexus/arcade-intelligence-2.0` and runs a deterministic planner. It does not call an external AI model. Pending official-source candidates are labelled as requiring human review; they are not treated as confirmed opportunities.

## Gemini API restriction
Gemini API is not included. Current Google Gemini API Additional Terms require API users to be at least 18 and prohibit use in API clients directed to or likely to be accessed by under-18s. As this is a public student-facing calculator, do not add Gemini calls or use another person's key to work around this restriction.

## Build and deployment
- Package version: **8.6.1**
- `index.html` build: **817**
- `app-builtin.html` build: **817**
- `netlify/functions/release.js` baseline: **817**
- First front-end-only Hot Update: **818 or higher**

Run `npm test` before a full deployment. Netlify uses `node tools/build.js`, publishes `dist`, and deploys Functions from `netlify/functions`. Use a full Git-connected deployment for any Function, redirect, header, asset, environment-variable or build-tool changes.

See [NETLIFY_DEPLOY_v8.6.1.md](NETLIFY_DEPLOY_v8.6.1.md), [SETUP_HOT_UPDATES.md](SETUP_HOT_UPDATES.md), and [ARCADE_INTELLIGENCE_SETUP.md](ARCADE_INTELLIGENCE_SETUP.md).
