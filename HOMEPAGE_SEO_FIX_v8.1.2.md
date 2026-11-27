# Homepage / Soft 404 repair — v8.1.2 (build 811)

The old `index.html` was a thin intermediate document with its own headline and loader text. It then fetched `app-builtin.html` and replaced the document. That means the crawler initially received a secondary page rather than the full calculator. While client-side rendering can be indexed, this structure can make diagnosis harder and may contribute to a Soft 404 classification. It is not possible to prove from source alone that it was the only cause.

This release makes `index.html` the full Arcade Points Calculator application, with a small meaningful HTML description already in `#root` before the app JavaScript renders. The interactive app replaces the placeholder content during normal startup. SEO metadata, canonical URL, robots directives, Search Console verification, sharing metadata, and WebApplication JSON-LD are in the same document head that is returned at `/`.

The hot-update check now runs after the built-in app has rendered and never hides the app when the release service is slow or unavailable. It replaces the page only when the endpoint returns a valid app whose build marker is greater than 811. `?builtin=1` bypasses the check. The release function baseline is 811, so the next front-end release must be 812 or higher.

No live Netlify deployment or Google indexing result is claimed by this archive. Run the included Netlify build, deploy it to the existing site, and then use Search Console's Live URL Test and Request Indexing.
