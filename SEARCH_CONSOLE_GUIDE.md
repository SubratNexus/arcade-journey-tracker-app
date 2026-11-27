# Google Search Console — Arcade Points Calculator

Site address: https://google-arcade-point-calculator.netlify.app/

The v8.1.2 project contains the Search Console verification tag you supplied, directly in the actual homepage (`index.html`) and built-in app (`app-builtin.html`). It also contains the title, description, canonical URL, sharing metadata, structured data, `robots.txt`, and `sitemap.xml`. Keep these files when making future full-site deployments.

## After deploying v8.1.2

1. Open Google Search Console and select the verified URL-prefix property for `https://google-arcade-point-calculator.netlify.app/`.
2. Open **URL Inspection** and enter the homepage URL.
3. Choose **Test Live URL**. Confirm that the page can be fetched and indexing is allowed.
4. When the live test finishes, choose **Request Indexing**.
5. Open **Sitemaps** and check that `sitemap.xml` is submitted and has no fetch error.

The sitemap contains the homepage URL because this is a single-page web application. `app-builtin.html` is an internal fallback file and is intentionally excluded from indexing. `/api/` endpoints are also blocked from search indexing.

## About the Soft 404 warning

The previous public `index.html` was a small intermediate loader that showed a separate loading/error page before fetching the real app. In v8.1.2, the homepage URL serves the complete calculator directly and includes useful HTML text before JavaScript runs. This removes that unnecessary intermediate step and may help Google reassess the page. It does not guarantee indexing: Google makes the final decision after crawling and rendering the live URL.

## Verification note

The verification token is included in the project source. As long as that meta tag remains in the deployed homepage, the HTML-tag verification method should remain valid. Do not delete the tag. If Search Console ever reports that ownership is not verified, use its verification details to confirm the exact property and method before changing the code.
