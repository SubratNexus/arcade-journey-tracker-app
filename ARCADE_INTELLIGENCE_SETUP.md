# Arcade Intelligence — existing GitHub agent and v8.6.1 connection

The background agent is already in the public repository:

`SubratNexus/arcade-intelligence-2.0`

It is separate from the Arcade Tracker website source repository. Do not upload website files into the agent repository.

## What runs in GitHub

The agent repository runs three GitHub Actions workflows:

- `arcade-intelligence.yml` — daily public Google Skills discovery and OCR catalogue refresh.
- `arcade-program-watch.yml` — scheduled Google Cloud Community watcher, YouTube public Atom feed monitor, evidence evaluation and public feed generation.
- `arcade-intelligence-ci.yml` — Python compilation, JSON checks and automated tests.

The workflows require no GitHub Secrets or repository Variables. They do not use a YouTube Data API key or SMTP password. The YouTube monitor uses the public channel Atom feed for two configured Google Cloud channels. This is an undocumented public feed endpoint, not a guaranteed API; Google/YouTube may change or restrict it. A successful request does not guarantee that a relevant Arcade video will be found.

## Public data outputs

- `agent-data/catalogue.json` — OCR discovery catalogue and candidates. The website can optionally use this to update its shared badge checklist.
- `agent-data/program-events.json` — internal event evidence and human-review state.
- `agent-data/youtube-observations.json` — relevant video metadata, if any matching videos are found.
- `agent-data/public-feed.json` — small read-only public feed consumed by the v8.6.1 Personal Arcade Agent through the Netlify Function.

The app's public programme feed and the optional badge catalogue are different files and serve different purposes.

## Verification policy

- A community post is labelled officially announced only when the originating author's public Discourse metadata contains the exact `google_staff` group marker.
- Moderator/admin flags, community replies and YouTube channel ownership alone do not establish a programme announcement.
- All official-source announcements remain `human_review_required` until an operator makes an explicit decision in `agent-data/review-decisions.json` tied to the current event fingerprint and source URL.
- Email is sent only for events marked `officially_announced`, `human_review_required: false`, and `notification_approved: true`, with the trusted author evidence still present.
- New or changed evidence invalidates a prior approval when the fingerprint changes.

At the last inspected run on 26 November 2026, the public feed contained 18 programme events and zero matching YouTube video observations. The agent state showed successful fetch timestamps for both channels, but that is not proof of complete YouTube coverage. The review decision list was empty, so no event was approved for email. These counts will change as the agent runs.

## Run or inspect the agent

1. Open the repository's **Actions** tab.
2. Select **Arcade Intelligence — programme watcher**.
3. Tap **Run workflow**, choose `main`, then run it.
4. Open the run and inspect each step. A successful workflow should finish the community watcher, YouTube feed check, evidence engine, public feed build and data publish steps.
5. Open `agent-data/public-feed.json` on `main` and check `generated_at`, `programme_events` and `youtube_videos`.

The schedule is not a real-time guarantee; GitHub can delay scheduled jobs. Manual dispatch is available.

## Netlify connection in v8.6.1

The Netlify Function at `/api/intelligence` fetches this fixed public file:

`https://raw.githubusercontent.com/SubratNexus/arcade-intelligence-2.0/main/agent-data/public-feed.json`

It validates the JSON schema, limits response size, filters source URLs, caches successful data for five minutes and uses a last-good cache if a later request fails. It exposes only selected public event/video fields to the browser. It does not send a visitor's profile to GitHub or the background crawler.

The optional Developer Mode catalogue panel still reads `agent-data/catalogue.json`; it is separate from the programme feed. A catalogue result being absent is not proof that a badge does not exist. OCR discoveries remain conservative and uncertain items stay as candidates.

## Limitations

The agent is evidence discovery, not an official Google service. OCR may miss dynamic pages or unreadable badges. The YouTube Atom feed is undocumented and may stop working. Event classifications require manual review. The agent never guesses special +2 point awards, never crawls private profiles and does not automatically edit the production calculator.
