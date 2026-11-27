# Arcade Journey Tracker v9.2.0 — Build 825

A full-source Netlify application with the points calculator, Gemini-powered Arcade Buddy, relevant-only background research, Developer Mode, email-approved Hot Updates, cross-browser profile backup, and a separate per-item approval bridge to the Arcade Intelligence GitHub agent.

## What's included in v9.2.0

- Preserves the complete v9.1.1 calculator, seasonal artwork, Developer Mode, Hot Update Manager, Gemini chat UI, cloud profile sync, and existing Resend approval flow.
- Connects Arcade Buddy's repository research to the agent repository's **`agent-data/approved-knowledge.json`** only. Pending `review-queue.json` proposals and the public discovery feed are not passed to the chatbot as approved facts.
- Keeps public discovery feeds available in the separate read-only feed view. Public feed observations are not silently promoted into chatbot-approved knowledge.
- Adds `/api/agent-review`, a separate owner review endpoint. Opening an email link only displays the proposal; the owner must press a second confirmation button to dispatch one decision.
- Stores review-link replay reservations in Netlify Blobs with conditional `onlyIfNew` writes. A repeated click on the same signed link cannot dispatch the same decision twice.
- Keeps the review endpoint separate from `/api/release`. The Hot Update approval and publish process is unchanged.
- Updates the app release to **v9.2.0 / Build 825**. The Hot Update service now accepts future HTML-only releases from Build 825 onward.

## Full project deployment — GitHub ZIP importer

This is a **full source project**, not just static HTML. The Netlify Functions are required for Gemini, profile backup, Hot Update approval, and Arcade Intelligence owner-review emails.

For this release, the connected GitHub repository is prepared to import the complete ZIP from its root. Keep the archive name exactly as supplied:

`Arcade-Journey-Tracker-v9.2.0-Private-Cloud-Account-Sync-Build-825.zip`

1. Open **`SubratNexus/arcade-journey-tracker-app`** and make sure you are on branch `main`.
2. At the repository root, choose **Add file → Upload files** and upload the ZIP itself. Do not extract it on your phone and do not place it inside another folder.
3. Commit the ZIP upload. The `bootstrap-zip.yml` workflow safely extracts the archive, removes the uploaded ZIP, runs `npm run check` and `npm test`, then commits the full source to `main`.
4. The follow-up workflow run caused by ZIP removal is expected to skip because there is no archive left to import.
5. Netlify automatically deploys the source commit from the connected branch. Its build settings are `node tools/build.js`, publish directory `dist`, and Functions directory `netlify/functions`.
6. Confirm the production deploy is published and that Functions include `intelligence`, `profile-data`, `release`, and `agent-review`.

Do not upload this app to `arcade-intelligence-2.0`. Do not deploy only `dist/` and do not use Hot Updates for this full release. Hot Updates replace only app HTML and cannot update Functions, dependencies, redirects, or server-side configuration.

## Gemini configuration — Arcade Buddy

Arcade Buddy calls Gemini from the server-side `/api/intelligence` Function. The browser never receives the API key.

| Netlify variable | Type | Required value |
|---|---|---|
| `AI_PROVIDER` | Plain variable | `gemini` |
| `GEMINI_API_KEY` | Secret | Your private Google AI Studio API key |
| `GEMINI_MODEL` | Plain variable; optional | Defaults to `gemini-2.5-flash` to support Google Search grounding on the Gemini API free tier |

Set these for the **Production** deploy context and include the **Functions** scope. Do not put the Gemini key into either HTML file, GitHub source, browser storage, or a chat message. When a question needs current information, Arcade Buddy enables Gemini's native Google Search grounding and displays the source links returned in Gemini's grounding metadata. The default `gemini-2.5-flash` model supports Google Search grounding on the Gemini API free tier (currently up to 500 requests per day shared with Flash-Lite). Gemini 3.x models use the newer `google_search` tool, but Google's current pricing page lists Search grounding for Gemini 3.x as unavailable on the free tier; using a 3.x model for grounding may require a paid tier. Keep `GEMINI_MODEL` unset for the free-tier default, do not enable billing if maintaining a zero-spend setup, and check Google's live quota/pricing page before deployment because these terms can change. Each Gemini request may issue multiple Search queries, so this is not unlimited.

## Arcade Intelligence owner-review email flow

This is a second system, independent from the Hot Update Manager. The background agent continues running in `SubratNexus/arcade-intelligence-2.0`. Its GitHub Actions digest emails each pending discovery with its own Approve and Reject links. Each link opens `/api/agent-review`; the owner reviews the evidence and confirms that one item. Only the confirmed item is sent to `arcade-review-apply.yml` and written into `approved-knowledge.json`.

### Netlify Production variables

Add these to the Netlify site connected to Arcade Tracker. Select **Production** and the **Functions** scope.

| Variable | Type | Required value / purpose |
|---|---|---|
| `AGENT_REVIEW_SECRET` | Secret | A new long random secret (at least 32 characters). Use the exact same value as the GitHub repository secret of the same name. Do not reuse the Gemini or Resend key. |
| `AGENT_GITHUB_TOKEN` | Secret | The fine-grained GitHub token for `SubratNexus/arcade-intelligence-2.0`, with **Actions: Read and write**. It is used only by the server-side review function. |
| `OWNER_EMAIL` | Secret | The owner email address that should receive approval messages. Add it to the new Netlify site if it is not already there. |
| `RESEND_API_KEY` | Secret | Your Resend API key for sending approval emails. Add it to the new Netlify site if it is not already there. |
| `MAIL_FROM` | Plain variable; optional | A sender address authorized by your verified Resend domain. Leave unset to use the existing default sender. |

Do not manually create `SITE_ID`, `URL`, or `NETLIFY_BLOBS_CONTEXT`; Netlify supplies the Blobs runtime context. No extra secret is required for profile cloud backup.

### GitHub repository secrets and variable

In **`SubratNexus/arcade-intelligence-2.0` → Settings → Secrets and variables → Actions**, set the following separately from Netlify. GitHub Actions cannot automatically read Netlify variables.

**Repository secrets:**
- `RESEND_API_KEY` — same Resend key used in Netlify.
- `OWNER_EMAIL` — same owner inbox.
- `AGENT_REVIEW_SECRET` — exact same secret as the Netlify value.
- `MAIL_FROM` — optional; use only a sender verified/authorized in Resend.

**Repository variable:**
- `AGENT_REVIEW_BASE_URL` = the HTTPS origin of your **new Netlify site** (for example, `https://your-new-site-name.netlify.app`).

Use the real URL shown in the new Netlify site's Domain management page, not the example above. Enter only the HTTPS origin (no `/api/agent-review` suffix and no trailing slash). If you changed Netlify accounts or site names, update this variable to the new site's URL.

The Netlify function expects the token name **`AGENT_GITHUB_TOKEN`**. Keep that exact variable name; it is the runtime name used by the function.

## Two separate email approvals — keep them separate

1. **Hot Update emails:** `/api/release` uses `OWNER_EMAIL`, `RESEND_API_KEY`, optional `MAIL_FROM`, and the existing short-lived owner confirmation process. The HTML update is not published until the owner confirms.
2. **Arcade Intelligence discovery-review emails:** the GitHub Actions `arcade-review-digest.yml` workflow uses its own repository secrets and `AGENT_REVIEW_BASE_URL`. The owner decides each proposal individually through `/api/agent-review`.

The app's optional Developer Mode approved-event digest is also separate from the review queue. Do not merge any of these approval paths or use one system's token as another system's key.

## Chatbot knowledge and verification policy

- Arcade Buddy's repository evidence comes only from `agent-data/approved-knowledge.json`.
- `agent-data/public-feed.json` and `agent-data/review-queue.json` are discovery/proposal data; pending proposals are not used as approved facts by the chatbot.
- Native Gemini Google Search grounding is used for questions that require live research, with grounding source URLs surfaced in the chat's Sources panel. Existing external web search, Google News, public community posts, and YouTube channel metadata remain separately classified evidence. A search result or community post is not automatically an official announcement.
- Official Google Cloud Community classification still requires the repository's exact trusted `google_staff` author metadata. Owner approval alone does not turn an untrusted source into an official Google announcement.
- The approved database in the current repository was initialized but was empty when it was last inspected. Until the owner approves records, Arcade Buddy may have no repository-approved programme/catalogue items to cite. This is intentional fail-closed behaviour, not a Gemini failure.
- A crawler finding is not proof of current availability, participant eligibility, dates, point values, or a reward. Check original sources.

## Profile cloud backup

The `profile-data` Function stores one private record per signed-in Netlify Identity account and Google Skills public profile ID in the site-wide Netlify Blobs store `arcade-user-profiles`. The backup includes manual badge overrides, learned classifications, manual bonus points, calculation settings, goals, seasons, custom keywords, snapshots, update history, and saved profile snapshots. The Function requires a verified Identity session before reading, saving, listing, or deleting data.

**One-time Netlify setup is required:** open your Netlify project, go to **Project configuration → Identity**, choose **Enable Identity**, and set registration to **Open** if new visitors should be able to create their own Arcade accounts. The app has an optional Arcade email/password sign-in; it is separate from Google Skills and does not ask for a Google password. Netlify Identity sends an email confirmation by default unless autoconfirm is enabled. After the user creates an account, signs in on a second device at the public app URL, the app restores the last saved profile and the account’s manual corrections/settings. Do not turn on mandatory site-wide visitor login; the calculator remains publicly accessible and only cloud sync requires an account.

This archive does not migrate the older public `arcade-profiles` store automatically. On the first deployment, a user should open the original device, sign in to their new Arcade account, and allow it to save the current local profile. Then use the same Arcade account on the second device. Netlify Blobs is object storage with last-write-wins behaviour, so avoid simultaneous edits to the same profile on multiple devices.

## Google Search grounding and cost guardrails

- Default model: `gemini-2.5-flash`, because Google's current pricing table lists Google Search grounding as free up to 500 requests/day on the Gemini API free tier (shared with Flash-Lite).
- The Gemini 2.5 REST request uses `google_search_retrieval`; if an owner deliberately sets a Gemini 3+ model, the adapter uses `google_search`.
- Search is invoked only when the planner classifies the question as requiring research. Ordinary greetings and evergreen questions do not trigger Google Search grounding.
- Gemini and Search quotas are provider-controlled. This is not unlimited and the app cannot prevent Google-side quota/rate limits.
- The app retains the existing public-source retrieval pipeline as supplementary evidence; Gemini Search source links are displayed separately in Arcade Buddy's Sources panel.

## Checks

Requires Node.js 20 or newer.

```bash
npm install
npm test
npm run build
```

Tests cover app/build synchronization, Gemini provider behaviour, profile backup logic, approved-only intelligence retrieval, and the per-item review endpoint (scanner-safe GET, explicit POST, and replay protection). These tests do not prove that live credentials, Resend delivery, GitHub Actions, or a production Netlify deploy are configured correctly; those integrations must be checked after deployment.

Never commit `.env` files, API keys, GitHub tokens, developer passwords, or secret values.

## Arcade Buddy chat behaviour

Arcade Buddy no longer has an application-level one-minute/two-messages-per-minute chat cooldown. The app accepts successive messages; Google's Gemini API quotas, provider rate limits, and Netlify's per-invocation runtime limits still apply. Each chat request is a normal synchronous Netlify Function request, not a seven-minute background job. The widget opens as a compact bottom-left panel and can be expanded to full screen.

## Free-plan usage note

Netlify Identity is included at no additional cost on current credit-based plans. Netlify Blobs is available on Free, but Functions compute, public web requests, API calls and bandwidth consume the site's monthly credits. The Free plan currently has a 300-credit monthly hard limit; when it is reached, the site may pause until the next cycle. Keep auto-recharge disabled and monitor the Netlify usage page. This app removes its own chat cooldown, but it cannot remove Google's Gemini API quotas or Netlify's platform limits.
