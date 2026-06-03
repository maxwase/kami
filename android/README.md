# Android (Google Play) — TWA build

Wraps the deployed PWA at `https://kami.maxwase.eu/` as a Trusted Web Activity
using [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap).

## Files

- `kami-upload.keystore` — upload signing key (alias `kami`). **Secret, gitignored.**
  Password used at generation: `kami-upload-pw` — change before production and store
  in a password manager. Losing this key means you can reset it via Play Console only
  if Play App Signing is enabled (recommended).
- `../twa-manifest.json` — Bubblewrap config (gitignored).
- `../public/.well-known/assetlinks.json` — Digital Asset Links, served at
  `https://kami.maxwase.eu/.well-known/assetlinks.json`.

## Prerequisites (one-time, must be live BEFORE building)

1. DNS: `kami.maxwase.eu` CNAME → `maxwase.github.io` (or A records to GH Pages IPs).
2. GitHub Pages: deploy this repo's `dist/` to the domain. `public/CNAME` handles the
   custom domain. Enable "Enforce HTTPS".
3. Verify these resolve over HTTPS:
   - `https://kami.maxwase.eu/manifest.webmanifest`
   - `https://kami.maxwase.eu/pwa-512x512.png`
   - `https://kami.maxwase.eu/.well-known/assetlinks.json`

## Build the .aab

```bash
npm i -g @bubblewrap/cli          # first run downloads JDK17 + Android build-tools to ~/.bubblewrap
cd /Users/max/dev/my/kami

# init pulls icons/manifest from the live site into the project
bubblewrap init --manifest=https://kami.maxwase.eu/manifest.webmanifest

# subsequent builds reuse ../twa-manifest.json
bubblewrap build                  # produces app-release-bundle.aab + app-release-signed.apk
```

`bubblewrap build` prompts for the keystore passwords (or set
`BUBBLEWRAP_KEYSTORE_PASSWORD` / `BUBBLEWRAP_KEY_PASSWORD`).

## After first upload to Play Console

Play App Signing re-signs the app with Google's own key. The **verified** fingerprint
is then Google's app-signing key, NOT the upload key above. After uploading:

1. Play Console → Setup → App signing → copy the **App signing key certificate**
   SHA-256 fingerprint.
2. Append it to `sha256_cert_fingerprints` in
   `public/.well-known/assetlinks.json` (keep the upload-key one for local testing).
3. Redeploy the site. Without this, the TWA shows the browser URL bar.

Play Console even generates the exact assetlinks.json snippet under the same page.
