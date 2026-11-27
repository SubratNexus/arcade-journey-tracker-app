# Netlify deployment and settings — v8.6.1

## Deployment target

Deploy this complete project to the **existing Netlify site** connected to the calculator's application repository. Do not upload this website source into `SubratNexus/arcade-intelligence-2.0`; that is the separate GitHub background-agent repository.

Project build configuration:

| Setting | Value |
|---|---|
| Build command | `node tools/build.js` |
| Publish directory | `dist` |
| Functions directory | `netlify/functions` |
| Node runtime | 18 or newer |
| Built-in app build | 817 |
| Release server baseline | 817 |

Upload/replace the full project root in the application repository, preserving `assets/`, `netlify/functions/` and `tools/`. Commit to the branch that the existing Netlify site deploys. The Git-connected deploy should then run automatically. Confirm the build log reports the build command above and deploys all seven Netlify Functions.

Do not use the Hot Update Manager for this release. Hot Update only replaces app HTML; v8.6.1 changes Netlify Functions and redirects too.

## Netlify environment variables

Private values belong in **Netlify → Site configuration → Environment variables**. Do not add values to GitHub, code, a `.env` file in the repository, `netlify.toml`, screenshots or this chat.

| Variable | Required? | Purpose |
|---|---|---|
| `RESEND_API_KEY` | Yes for owner emails | Resend API key used for Hot Update approval messages and owner digest delivery. |
| `OWNER_EMAIL` | Yes for owner emails | Destination inbox (your Gmail address can be used as the recipient). |
| `MAIL_FROM` | Optional | Verified sender address. If blank, the existing Resend test-sender fallback is used. |
| `ADMIN_PASSWORD_HASH` | Keep existing if set | Existing Developer Mode password hash override. Do not replace it during this deployment if the current login works. |
| `TOKEN_SECRET` | Keep existing if set | Existing Developer Mode token-signing secret override. Do not replace it during this deployment if the current login works. |

This application uses Resend to **send** owner messages to your inbox. It does not sign in to Gmail or read your Gmail messages. Do not create or enter a Gmail password, App Password or Gmail API key for this integration.

### Free-plan environment-variable scope

Netlify's current documentation says setting specific environment-variable scopes is available on Pro and above. On the Free plan, leave the default available scope as Netlify presents it; do not upgrade just to choose a specific scope. The project reads these values only from server-side Functions with `process.env`, and the build script does not print them. Netlify applies changed environment values to a new deploy, so redeploy after edits.

### Zero-billing guard

- Keep the Netlify site on **Free**. The current Free plan includes 300 monthly credits with a hard limit; when the limit is reached, projects pause until the next billing cycle. Do not enable auto recharge or upgrade.
- Resend currently lists a Free plan with 3,000 emails per month and 100 per day. Stay within that cap and do not enable paid overages.
- This release does not require YouTube API keys or Google Cloud billing.
- This release has no Gemini API integration and no `GEMINI_API_KEY` variable. Google's current Gemini API terms require the API user to be 18+ and prohibit using the API in an application likely to be accessed by under-18s. Because this is a public Arcade calculator, this build uses the deterministic Personal Arcade Agent instead. Do not try to work around those age/use restrictions by using someone else's key.

## Verify after deployment

1. Open `/api/release?m=health`. Check `storageReady: true`, `baseBuild: 817`, and `mailReady` (true only when `RESEND_API_KEY` and `OWNER_EMAIL` are configured).
2. Open `/api/intelligence?m=health`. Check `ok: true`, `externalAi: false` and the email configured status.
3. Open `/api/intelligence?m=feed`. It should return a schema-valid read-only public feed, or a clear temporary-unavailable response if GitHub cannot be reached.
4. Open `/api/community`. The existing Community service should respond as before.
5. In Developer Mode → Arcade Intelligence, tap **Check feed and AI service**.
6. Open a profile, choose hours/focus, and tap **Build my plan** in the Arcade Personal Agent. Confirm the response cites your profile totals/checklist and labels unreviewed announcements as awaiting review.
7. Check the ordinary calculator, saved profiles, logout/data-clear separation, light/dark theme, seasonal artwork, force refresh, and Developer Mode Hot Update Manager.

The current agent's review-decision file contains no approved items. The digest button should therefore report no human-approved announcements rather than sending pending candidates. Email sending is not a substitute for human review.

## What has and has not been tested

The package's local automated tests and static build checks are recorded in `TEST_REPORT_v8.6.1.md`. No live Netlify deploy, real Resend email, or live browser session has been run from this build environment. Treat the API checks above as post-deploy verification, not as already-completed production tests.
