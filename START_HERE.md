# Start here — GitHub upload, then Netlify

This ZIP contains the complete Arcade Journey Tracker source (not just the robot). It retains the calculator, existing full-body Arcade Buddy interface, seasonal posters, Developer Mode, Hot Update Manager, and the existing Netlify Functions. Arcade Buddy's public research now runs in the background and the chat shows only the completed answer and safe source links.

## Phone-friendly GitHub import

This project includes `.github/workflows/bootstrap-zip.yml`. Because this archive contains many folders and seasonal images, the easiest phone workflow is to install that one small workflow first, then upload the full ZIP once. GitHub Actions will safely extract the archive, run the project checks, remove the uploaded ZIP from the repository, and commit the actual source files to `main`.

1. Open the empty repository: `https://github.com/SubratNexus/arcade-journey-tracker-app`.
2. Choose **Add file → Create new file**.
3. For the filename, enter exactly: `.github/workflows/bootstrap-zip.yml`.
4. Open the downloaded `bootstrap-zip.yml` file, copy all its text, and paste it into GitHub's editor.
5. Commit directly to `main` with the message `Add safe project ZIP importer`.
6. Return to the repository root. Choose **Add file → Upload files** and upload exactly `Arcade-Journey-Tracker-v8.6.2-Arcade-Buddy-GitHub-Upload.zip`.
7. Commit the ZIP directly to `main` with the message `Upload complete Arcade Journey Tracker source`.
8. Open the **Actions** tab. The workflow named **Import complete Arcade Journey Tracker source** should run automatically. Wait for its green check; it runs both `npm run check` and `npm test` before committing the extracted project.
9. After the import workflow succeeds, open **Actions → Arcade Journey Tracker + Arcade Buddy CI → Run workflow**, choose `main`, and run it once. Confirm that it also finishes successfully.

Do not unzip the ZIP into the repository manually and do not leave the ZIP file in the repository. The importer extracts it and deletes the uploaded archive automatically.

## Then Netlify

Do not connect Netlify before both GitHub workflows are green. The next stage is to connect `SubratNexus/arcade-journey-tracker-app` to the existing `google-arcade-point-calculator` Netlify site, confirm `main` as the production branch, and check a Deploy Preview before production publishing. The repository's `netlify.toml` already defines the existing build and function paths; do not replace it with a new starter configuration.

## Project checks

Node.js 20 or newer. No `npm install`, API key, paid provider, Google login, or GitHub secret is required for the included checks.

```sh
npm run check
npm test
```

Keep `.netlify/`, `dist/`, `node_modules/`, and local secret files out of Git. `.gitignore` already excludes these paths.
