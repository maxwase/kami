# Building & releasing kami

iOS is a separate app (bundle `eu.maxwase.kami.ios`, Capacitor) — see
[iOS](#ios) at the end. The rest of this document is macOS.

## Requirements

- Node.js 18+ (Vite 8)
- pnpm 11+
- A modern [browser](https://developer.mozilla.org/en-US/docs/Web/API/Device_Posture_API) to actually test folding. Note that the API is only available on localhost or HTTPS connections.
- Or [stable Rust](https://rustup.sh) when building with `tauri` for MacOS.
- Or Xcode 16+ when building for iOS.

## Web

```sh
pnpm install
pnpm run dev    # start Vite dev server
pnpm run build  # type-check + production build to dist/
```

# macOS

There are three macOS build variants. All three build from the same source; they differ only in signing identity and entitlements.

| Variant      | Config                                         | Distribution                         |
| ------------ | ---------------------------------------------- | ------------------------------------ |
| Dev          | `tauri.conf.json` (default)                    | Local testing, unsigned              |
| Direct (DMG) | `tauri.conf.json` (default)                    | Notarized DMG, outside the App Store |
| App Store    | `tauri.conf.json` + `tauri.appstore.conf.json` | Sandboxed `.pkg`, Mac App Store      |

## Dev build

```sh
pnpm install
pnpm run tauri dev
```

## Direct distribution (signed + notarized DMG)

Requires `.env` filled in with `APPLE_SIGNING_IDENTITY`, `APPLE_TEAM_ID`, `APPLE_ID`, `APPLE_PASSWORD` (see `.env.example`). The cert must already be in your local Keychain (Xcode → Settings → Accounts → Manage Certificates → "Developer ID Application").

```sh
pnpm build:mac:signed
```

Tauri signs and notarizes automatically when it sees those env vars — no extra steps. Output: `src-tauri/target/release/bundle/dmg/kami*.dmg`.

### In CI

`.github/workflows/macos.yml` runs the same build with the equivalent GitHub Actions secrets (`APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`). Trigger manually:

```sh
gh workflow run macos.yml --repo maxwase/kami
gh run watch --repo maxwase/kami
```

## Mac App Store (sandboxed `.pkg`)

Requires an **Apple Distribution** cert (app signing) and a **3rd Party Mac Developer Installer** cert (pkg signing) in Keychain (Xcode → Settings → Accounts → Manage Certificates), plus a Mac App Store provisioning profile downloaded from developer.apple.com and installed (double-click).

`src-tauri/tauri.appstore.conf.json` overrides `bundle.macOS` with the App Sandbox entitlements (`src-tauri/entitlements.plist`), the App Store Info.plist additions (`src-tauri/Info.appstore.plist`), and the Apple Distribution signing identity. It's kept separate from `tauri.conf.json` so the direct-distribution DMG build never gets sandboxed by accident.

`entitlements.plist` also carries `application-identifier` (`<TEAM_ID>.eu.maxwase.kami`) and `com.apple.developer.team-identifier` (`<TEAM_ID>`) — Xcode injects these automatically from the provisioning profile at sign time, but this manual pipeline signs before the profile is even in the bundle, so they have to be declared explicitly or Transporter rejects the upload as ineligible for TestFlight (error 90886).

`Info.appstore.plist` sets `LSApplicationCategoryType` — required by App Store validation (error 90242). Its value must match whatever Primary Category is picked in App Store Connect's app metadata.

Must build with `--target universal-apple-darwin` (arm64-only is rejected — error 90869, no Intel support). One-time: `rustup target add x86_64-apple-darwin aarch64-apple-darwin`.

`scripts/build-appstore.sh` runs the whole pipeline — build, embed profile, strip quarantine (error 91109), re-sign, package:

```sh
pnpm build:appstore            # build + sign + package only
pnpm build:appstore:upload     # also upload via iTMSTransporter (reads APPLE_ID/APPLE_PASSWORD from .env)
```

Output: `src-tauri/target/universal-apple-darwin/release/bundle/macos/kami.pkg`. Upload uses `xcrun altool --upload-package` — `iTMSTransporter` is deprecated and commonly fails with "Client configuration failed" on modern macOS. Alternatively upload via Transporter.app (drag the .pkg in).

Note: App Store Connect rejects a re-upload with the same version + build number as one already submitted — bump `version` in `src-tauri/tauri.conf.json` before re-running after a rejected/duplicate build.

Verify the signature, entitlements, and universal architecture before uploading:

```sh
codesign --verify --deep --strict --verbose=2 "$APP"
codesign -d --entitlements - --xml "$APP"
file "$APP/Contents/MacOS/kami-tauri"   # should list both x86_64 and arm64
```

# iOS

The iOS app is the web build wrapped in [Capacitor](https://capacitorjs.com/).
`ios/` holds the Xcode project; the web assets are copied into it on every sync.

```sh
pnpm install
pnpm ios:run     # build, sync, and launch in the simulator
pnpm ios:open    # or open the Xcode project to run on a device
pnpm ios:sync    # re-copy the web build after changing src/
```

iPhone-only, and there is no hinge sensor to read: iOS exposes no fold/posture
API (checked against the iOS 26.5 SDK), so `src/device/capacitor.ts` is a stub
and folding is driven by the on-screen buttons plus the accelerometer. Motion
access is requested on the first tap, since iOS only grants it from inside a
user gesture — denying it leaves everything else working.

## iOS App Store

The iOS app is the same web build wrapped in Capacitor, released as its own App
Store record — it does **not** share the macOS bundle identifier.

|           | macOS                       | iOS                    |
| --------- | --------------------------- | ---------------------- |
| Shell     | Tauri                       | Capacitor              |
| Bundle ID | `eu.maxwase.kami`           | `eu.maxwase.kami.ios`  |
| Team ID   | `YX238Y6233`                | `YX238Y6233`           |
| Artifact  | sandboxed `.pkg`            | `.ipa`                 |
| Script    | `scripts/build-appstore.sh` | `scripts/build-ios.sh` |


### Build and upload

```sh
pnpm build:ios:appstore          # archive + export a signed .ipa
pnpm build:ios:appstore:upload   # ...and upload it via altool
```

Bump `MARKETING_VERSION` (currently `0.1.0`) and `CURRENT_PROJECT_VERSION` in
`ios/App/App.xcodeproj/project.pbxproj` before each upload; App Store Connect
rejects a build number it has already seen.
