> Historical note: this file documents the v8.1.1 repair (baseline 810; first hot release 811). v8.1.2 advances the built-in homepage baseline to 811, so new hot releases must now be 812 or higher. See `SETUP_HOT_UPDATES.md` for current instructions.

# Release-system repair notes — Arcade Tracker v8.1.1

## Confirmed root cause

The uploaded v8.1 project declares build 810 in both the loader (`index.html`) and built-in app (`app-builtin.html`). Earlier hot-update ZIPs discussed for this project used builds 804 and 805. The upload function previously compared a new build only with an already-active hot release; when no release was active, it could accept 804/805. After approval, the loader requested a release newer than 810, so the function returned no hot app and the normal built-in app continued to load. Email approval therefore succeeded without a visible site change.

## Repairs

- Added a server-side build floor of 810. First valid hot update is 811.
- Loader rejects any stored release not newer than both build 810 and its own requested build.
- Added `/api/release?m=health` diagnostics and richer Developer Mode status.
- Added per-release deletion for both the live release and archived releases.
- Added a confirmation/read-back step after switching the active release.
- Kept the pending approval record until publication has been verified, so a transient storage problem does not consume the email link prematurely.
- Removed the 30-second edge cache hint from the hot-app response and set no-store cache headers.
- Added a build-time consistency check so the loader, built-in page, and release function cannot silently drift apart.
- Added a real build step that publishes only browser-facing files to `dist/`; function source, tools, and project notes stay outside the public directory.
- Strengthened the DOM badge guard. The official Powered by Netlify badge still needs to be disabled in the Netlify project setting because it is rendered by Netlify in an isolated frame.

## Validation performed locally

- `npm run build` passed.
- All six Netlify function source files passed Node syntax checks.
- Executable inline JavaScript in `index.html` and `app-builtin.html` passed syntax checks.
- A mocked Netlify Blobs/Resend test exercised the release lifecycle: health check, rejection of build 810, acceptance of 811, email link generation, approval, live app response, no-newer-build fallback, and deletion of the active release. All tests passed.

A real production Netlify deploy, real email delivery, and live-site behavior cannot be tested from this workspace. The full project must be deployed once before the repaired server-side gate can take effect.
