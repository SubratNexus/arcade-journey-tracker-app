# v8.6.0 local validation report

Date: 27 November 2026

## Automated results

Command: `npm test`

- Static smoke tests: **passed**.
- Intelligence Function tests: **passed**.
- Inline JavaScript syntax: **passed** for both HTML entry points.
- Netlify Function JavaScript syntax: **passed** for all 7 Functions.
- Build output: **created successfully** in `dist`.

Coverage includes build-number consistency, app ID, catalogue endpoint routing, saved-profile/logout/data-clear separation, dashboard ordering, Personal Arcade Agent UI, no external model API/key, personal data minimisation, trusted-source allowlisting, strict human-approval gates, deterministic planner output, public-feed response handling, request rate/body limits and digest authentication.

## Additional checks

- `netlify.toml` parsed successfully with Python's TOML parser.
- `dist/` contains the static website and assets only; Netlify Function source and developer tools are not copied into the public publish folder.
- Build number 816 matches `index.html`, `app-builtin.html` and `netlify/functions/release.js`.
- No Gemini API URL or `GEMINI_API_KEY` use remains in runtime code. The personal planner is deterministic and does not call an external model provider.
- No secrets are included in source or test fixtures. The Netlify environment variable values must be supplied by the site owner through the Netlify dashboard.

## Not performed

- No live Netlify deployment was performed.
- No production browser/device interaction test was performed.
- No real Resend email was sent.
- The build container could not directly fetch GitHub's raw public feed over the network; mocked-feed tests passed. The feed must be checked after deployment using `/api/intelligence?m=feed`.
- No live YouTube Atom feed availability test was performed by the build container.

The package is locally build-validated, not production-deployed. Run the post-deployment checklist in `NETLIFY_DEPLOY_v8.6.0.md` before treating the update as live.
