# Arcade Journey Tracker v8.4.0 — built-in build 814

## Critical fix: shared Skill Badge catalogue

The Developer Mode catalogue and keyword controls called the release API by mistake. The release function does not implement `catalog_save`, so add/retire/restore operations received HTTP 400 and were not persisted. v8.4.0 introduces a dedicated authenticated community API client that posts these operations to `/api/community`, where the existing catalogue handler is implemented.

The Skill badges panel now explains that Active titles are included in the public Skill checklist and Retired titles are hidden but retained. Restore reactivates them. Server persistence means edits survive logout and refresh.

## Developer workspace navigation

Tabs use a two-column responsive grid instead of a one-line horizontal scroller, preventing the final tabs from being clipped on narrow mobile screens.

## Hot update manager

- Separates service status, update method, live/pending state and release history.
- Adds **Upload ZIP / HTML** and **Paste code** modes.
- Paste mode accepts a complete Arcade Tracker HTML document containing the required app ID and build markers. HTML/CSS/JS fragments alone are not accepted.
- Client-side checks report missing markers, outdated builds and files larger than 1,536 KB before upload. The server still performs its own validation and JavaScript syntax checks.
- Existing owner email approval, rollback, disable and delete flows are retained.
- Clearly explains that backend/function/configuration/assets changes require a full Netlify deployment.

## Build and deployment

Build baseline: 814. First accepted hot update: 815 or higher (and greater than the current active release). Full deployment is required because this release modifies `netlify/functions/community.js` and `netlify/functions/release.js`.
