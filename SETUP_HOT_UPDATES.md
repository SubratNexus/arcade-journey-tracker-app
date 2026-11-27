# Hot updates — Arcade Tracker v8.6.1

The complete calculator loads its built-in app, then checks for a newer owner-approved front-end release. Add `?builtin=1` to bypass the hot-update check.

## Current build baseline
- Public homepage `index.html`: **817**
- Built-in calculator `app-builtin.html`: **817**
- `netlify/functions/release.js` baseline: **817**
- First permitted Hot Update: **818** (or higher than any currently active release)

`tools/build.js` validates that the three build values match before publishing.

## Netlify environment variables
Keep private values in Netlify only. Preserve existing working values. The project uses `RESEND_API_KEY` and `OWNER_EMAIL` for owner approval/digest email, optional `MAIL_FROM`, and any existing `ADMIN_PASSWORD_HASH` / `TOKEN_SECRET` overrides.

After changing environment variables, trigger a new full deploy. See `NETLIFY_DEPLOY_v8.6.1.md` for the Free-plan and variable notes.

## Arcade Buddy and Gemini
The floating robot launcher opens the Personal Arcade Agent. It calls the site's rule-based `/api/intelligence` planner and does not make external model requests. Gemini API is deliberately not connected: Google's current Gemini API terms require API users to be 18+ and bar use in API clients likely to be accessed by under-18s. This public student-facing site must not call Gemini.

## Upload a hot update
1. Start with the complete current `app-builtin.html`.
2. Make only front-end changes and raise `<meta name="app-build">` to at least **818**, and above any active release shown in Developer Mode.
3. Upload the standalone HTML or a full project ZIP containing `app-builtin.html`.
4. In Developer Mode → Hot Updates, enter a release label and upload.
5. The owner must approve the email. The release is not live before approval.

The extracted HTML must be no more than 1.5 MB. A Hot Update replaces only app HTML. It cannot deploy Netlify Functions, assets/posters, redirects, headers, environment variables or build tooling.

## Rollback and troubleshooting
- Add `?builtin=1` to skip the hot release and use the deployed built-in app.
- Developer Mode can cancel a pending release, disable an active release, restore a stored release or delete active/archived releases.
- `mailReady: false`: check the existing Resend variables in Netlify and redeploy.
- `storageReady: false`: inspect Netlify Blobs availability and Function logs.
- “Build too old”: use a build greater than 817 and the current active release.
- “No app file found”: include `app-builtin.html`, `app.html` or `index.html` in the ZIP.
