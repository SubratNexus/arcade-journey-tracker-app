# v5.6 reports

## Changelog
Changed: first page now uses 12 real poster wallpapers (desktop landscape + dedicated mobile portrait, each with a smaller -sm variant, chosen via <picture>); glass calculator panel (blur, tinted border, glow) centred in the middle of the first screen (max 520px wide, 360px on phones); heading "Journey Point Calculator"; button "Calculate Points"; wallpaper picks itself by date (festival window, else season) and is rechecked hourly and on tab focus; fireworks bursts on New Year/Diwali/Republic/Independence; Netlify-badge guard (CSS + tiny observer); version v5.6; README entry.
Preserved: analyze.js, img.js, views.js, netlify.toml, Smart Scan, all tabs, settings, profile saving, validation messages, season colours and particles, theme toggle, paste mode.

## Test report (what I actually ran, headless Chromium via Playwright, local server)
- All 12 posters load for the correct season id, at 390px (mobile file) and 1440px (desktop file): pass.
- Viewports 320, 360, 390, 430, 768, 1440, 1920 in light and dark: no horizontal overflow; panel, input and button geometry identical between themes: pass.
- Invalid link shows the existing "doesn't look like a Google Skills public profile" message: pass.
- No page errors, no 4xx asset responses, no netlify-named elements in DOM: pass.
- NOT tested: a live profile fetch (no network here), the Netlify functions, real touch hardware, a real Netlify deploy, 30-day scroll/CPU profiling.

## Asset report
12/12 desktop (1920w + 1280w) and 12/12 mobile (1080w + 720w) posters integrated, ~8 MB total, WebP q80. Files: assets/posters/{desktop,mobile}/<season>.webp and <season>-sm.webp.

## v5.7 tests actually run
- Screenshot titles (81 non-Arcade badges) through the app's real classifier: before 76 skill / 4 completion / 1 excluded; after 77 skill / 4 completion. With 17 Arcade games = 98.
- Mocked refresh that finds 2 new badges: Updates saved, bell showed 2, Updates screen opened with 2 items, no page errors (before the fix: ReferenceError UL).
- NOT tested: live Google profile fetch, real Netlify deploy.
