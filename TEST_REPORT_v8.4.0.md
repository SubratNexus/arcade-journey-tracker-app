# v8.4.0 verification report

Verification was run locally against the supplied v8.3.0 Netlify project source after applying the v8.4.0 changes.

## Passed

- `npm test` completed successfully.
- The static smoke test checks the synchronized build markers, confirms the browser's shared catalogue save uses the community API, confirms the release API does not implement the catalogue action, confirms the active checklist filter and add/retire/restore UI labels, and confirms the Hot Update paste editor and validation flow are present.
- The project build completed successfully. It syntax-checked the inline scripts in `index.html` and `app-builtin.html`, and all six Netlify Function JavaScript files.
- A local integration test with a mock Netlify Blobs store exercised authenticated catalogue save, public read-back, a Retired state change, and read-back of the persisted retired state.

## Not claimed / still needs verification after deployment

- This project has not been deployed to the live Netlify site from this environment.
- The actual live Netlify Blobs service, the owner's approval email delivery, and the live mobile browser UI were not tested against the production site.
- After full deployment, verify `/api/release?m=health`, then add a temporary skill title, reload, retire it, reload, and restore it. Verify both Upload and Paste Code appear in Developer Mode > Hot updates.

## Why the HTTP 400 occurred

The supplied frontend sent `catalog_save` to `/api/release`, while the supplied `netlify/functions/community.js` is where the `catalog_save` action is implemented and `/api/community` is routed. The release function does not implement that action. v8.4.0 routes catalogue and keyword writes through `/api/community`.
