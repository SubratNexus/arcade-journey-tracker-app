# Arcade Tracker v8.6.1 — Arcade Buddy

Build: 817  
Date: 27 November 2026

## What changed
- Added a small robot launcher fixed to the lower-left corner of the dashboard.
- Added an accessible pop-up assistant panel with weekly time and focus preferences, quick prompts, a question field, response state, and feed status.
- Moved the Personal Arcade Agent out of the large What-if Planner card into the floating robot interface.
- Connected the robot panel to the existing `/api/intelligence` rule-based planning endpoint.
- Preserved calculator/profile logic, seasonal posters, themes, Developer Mode, Hot Update Manager, Netlify Functions, and existing security gates.

## AI provider status
Gemini API is not integrated. Google's Gemini API Additional Terms, effective 23 March 2026, require API users to be at least 18 and prohibit use in applications directed to or likely to be accessed by people under 18. This is a public student-facing calculator. The robot therefore uses the existing deterministic planner and verified public feed instead; it must not be configured to forward requests to Gemini.

## Privacy
Only whitelisted points, tier, counts, earned badge titles, remaining checklist titles, weekly time, focus and the user's question are submitted to the site's Netlify Function. The profile URL, display name, email address and Google login credentials are not sent. The rule-based planner does not call an external model provider.
