# Arcade Journey Tracker v8.5.0 — built-in build 815

## Logout and local-data separation

- Adds a dedicated **Log out** action in Profile settings and the saved-profile menu.
- Logout clears only the active profile state and returns to the landing page. It does not delete saved profile snapshots, manual badge-category corrections, personal Game/Skill keywords, manual bonus-event points, Facilitator settings, themes or preferences.
- **Clear My Data** remains the separate destructive control. Its confirmation now explicitly lists saved profiles, manual corrections, keywords, bonus-event names and points, Facilitator settings, preferences and local cached data.

## Home dashboard structure

Immediately below the profile stats and progress ring, the page now shows: Facilitator Program, Manual bonus events, Monthly Arcade games, and Where did my points come from? Activity timeline follows these priority sections.

The progress card includes a compact summary for positive extra sources: Facilitator bonus, Special games and Manual bonus events. Values are taken from the same calculation used for the displayed total.

## AI image-reader removal and future assistant placeholder

- Removes the Settings image-reading explainer panel that could be confused with an optional external AI image service. There is no Gemini image-reading UI or Gemini API integration in this build.
- Keeps the existing local app's ordinary badge classification and Smart Scan setting as implemented in the source.
- Adds a clearly marked, inactive **Arcade AI Assistant — Planned feature** placeholder inside What-if planner. No chatbot, external AI calls or profile-data access have been implemented. Its behaviour remains subject to the requirements to be provided later.

## Refresh reliability

- Force refresh bypasses browser caching with `cache: no-store`, no-cache headers and a unique query parameter, while retaining the server's `fresh=1` parameter to bypass its short in-memory cache.
- The floating refresh control exposes its busy state and clearer accessibility/title text.
- Manual refresh provides immediate feedback, completion feedback (including when nothing changed), and a 27-second watchdog that restores the control if a request stalls.

## Version and deployment

Built-in app build: **815**. Netlify release baseline: **815**. First accepted hot-update build: **816 or higher**, and it must also be newer than any active release.

This release modifies the app source, package metadata, release baseline and smoke tests. Deploy the complete Netlify project ZIP; do not install this release through Hot Update.
