# v8.6.1 local validation report

Build: 817  
Date: 27 November 2026

## Executed result
Command: `npm test`
- Static smoke tests: **passed**.
- Intelligence Function tests: **passed**.
- Build-number consistency check: **passed** for `index.html`, `app-builtin.html` and `netlify/functions/release.js`.
- Inline JavaScript syntax: **passed** for both HTML entry points.
- Netlify Function syntax: **passed** for all 7 Functions.
- Netlify build: **passed**; `dist/` was created without publishing Function source or developer tools.

Coverage includes the floating robot dock in both app entry points, planner route wiring, privacy minimisation, public-feed validation, no external AI calls, source allowlisting, strict human-review email gate, rate limits, build synchronization and hot-update protections.

## Not performed
No live Netlify deployment, real Resend email, direct GitHub feed request, or end-to-end Android browser interaction test has been performed in this environment. Verify the deployed APIs and robot panel after deployment.
