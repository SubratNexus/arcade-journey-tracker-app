# Hot Update Kit (reusable for any future app or website)

Claude does not remember earlier chats. To reuse this system in a new project, upload this file (and the `netlify/functions` files named below) to the new chat and say:
"Use my Hot Update Kit from HOT_UPDATE_KIT.md for this new project. All app and developer-panel text must be in English."

## What it is
A way to update a Netlify site without redeploying:
- `index.html` is now the complete calculator homepage. After the built-in page loads, it asks `/api/release?m=app&b=<BUILD>` for an approved newer `app.html` and replaces the page only when a newer valid release is returned. `?builtin=1` skips that check.
- `netlify/functions/release.js` stores the extracted app HTML in Netlify Blobs (`site:releases`), validates it, emails the owner an approval link, and publishes after the owner presses Approve. The current browser uploader extracts `app-builtin.html` from a project ZIP before sending it; the server retains its small legacy `app.html` ZIP parser for older clients.
- `netlify/functions/community.js` provides the developer login (scrypt-hashed password, 5 tries then a 15-minute lock, 2-hour signed token). The password itself is never in the code.
- The developer panel opens after tapping a "Developed by <name>" credit 7 times, then asking for the password.

## Rules to keep
1. Edit `app-builtin.html` (the real app). `app.html` in a release ZIP is a copy of it.
2. Each app page needs `<meta name="app-id" content="...">` and `<meta name="app-build" content="N">`. Build numbers must increase. The loader's `BUILD` constant must match the built-in build.
3. Approval email must be sent by the server (Resend). Web3Forms cannot be used for approvals: its free plan only works from the browser, so the uploader would see the approval link.
4. Never put the developer password in code. Store only a salted scrypt hash, or `ADMIN_PASSWORD_HASH` in Netlify. Do not keep the project in a public repo.
5. No Netlify badge or snippet injection. Keep the Content-Security-Policy headers in `netlify.toml`.
6. All visible text in the app and developer panel is English.
7. Do not rename storage names (`site:community`, `site:sitestats`, `site:seasons`, `site:releases`) or old data is lost.
8. Test before delivery: server functions with a fake blob store, browser flows with Playwright (loader fallbacks, panel, approval), and report only tests that were really run.

## Environment variables (Netlify)
`RESEND_API_KEY`, `OWNER_EMAIL` (same email as the Resend account), optional `ADMIN_PASSWORD_HASH`, `TOKEN_SECRET`, `MAIL_FROM`.

## Limits to remember
The Developer Mode browser uploader can read a full project ZIP up to 40 MB, extract `app-builtin.html` / `app.html`, and submit only that HTML. The server-side extracted HTML limit is 1.5 MB. The hot-update service does not deploy Functions, assets, redirects, environment variables or build tooling; those require a normal full project deploy. Do not depend on an email approval until `/api/release?m=health` reports both storage and mail as ready.


## Arcade Tracker v8.5.0 baseline note
The current public/built-in baseline is build 817 (v8.6.1). The first valid hot release is build 818 (and any upload must also be newer than the active release). Keep the app-build markers in `index.html`, `app-builtin.html`, and `netlify/functions/release.js` synchronized; `tools/build.js` validates them before the Netlify build.

The current uploader accepts standalone app HTML or a full project ZIP. The browser extracts only the app HTML. Hot updates cannot change Functions or assets.
