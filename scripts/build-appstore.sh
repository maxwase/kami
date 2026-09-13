#!/usr/bin/env bash
# Build, sign, and package kami for the Mac App Store (sandboxed .pkg).
# See RELEASING.md for the manual step-by-step this automates.
#
# Usage:
#   scripts/build-appstore.sh           # build + sign + package only
#   scripts/build-appstore.sh --upload  # also upload the .pkg via altool
#
# --upload reads APPLE_ID and APPLE_PASSWORD from .env (see .env.example).

set -euo pipefail
cd "$(dirname "$0")/.."

APP_SIGNING_IDENTITY="Apple Distribution: Maksim Tatarchenkov (YX238Y6233)"
INSTALLER_SIGNING_IDENTITY="3rd Party Mac Developer Installer: Maksim Tatarchenkov (YX238Y6233)"
PROFILE="src-tauri/profiles/Kami_Mac_App_Store.provisionprofile"
ENTITLEMENTS="src-tauri/entitlements.plist"
BUNDLE_DIR="src-tauri/target/universal-apple-darwin/release/bundle/macos"
APP="$BUNDLE_DIR/kami.app"
PKG="$BUNDLE_DIR/kami.pkg"
BUNDLE_ID="eu.maxwase.kami"
APP_APPLE_ID="6810974882" # App Store Connect > App Information > Apple ID

UPLOAD=false
for arg in "$@"; do
  case "$arg" in
    --upload) UPLOAD=true ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

echo "==> Building signed, sandboxed, universal .app"
pnpm tauri build --bundles app --target universal-apple-darwin --config src-tauri/tauri.appstore.conf.json

echo "==> Embedding provisioning profile"
cp "$PROFILE" "$APP/Contents/embedded.provisionprofile"
xattr -cr "$APP"

echo "==> Re-signing (embedding the profile after signing breaks the seal)"
codesign --force --deep \
  --sign "$APP_SIGNING_IDENTITY" \
  --entitlements "$ENTITLEMENTS" \
  --options runtime \
  "$APP"

echo "==> Verifying signature"
codesign --verify --deep --strict --verbose=2 "$APP"

echo "==> Packaging as installer"
productbuild --component "$APP" /Applications \
  --sign "$INSTALLER_SIGNING_IDENTITY" \
  "$PKG"

echo "==> Built: $PKG"

if [ "$UPLOAD" = true ]; then
  if [ ! -f .env ]; then
    echo "No .env found — copy .env.example and fill in APPLE_ID/APPLE_PASSWORD." >&2
    exit 1
  fi
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
  : "${APPLE_ID:?APPLE_ID not set in .env}"
  : "${APPLE_PASSWORD:?APPLE_PASSWORD not set in .env}"

  VERSION=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' src-tauri/tauri.conf.json | head -1)

  echo "==> Uploading $PKG to App Store Connect (version $VERSION)"
  # iTMSTransporter is deprecated/broken on modern macOS ("Client configuration
  # failed"); altool --upload-package is Apple's current CLI path for .pkg uploads.
  xcrun altool --upload-package "$PKG" \
    --type macos \
    --asset-description "kami" \
    --apple-id "$APP_APPLE_ID" \
    --bundle-id "$BUNDLE_ID" \
    --bundle-version "$VERSION" \
    --bundle-short-version-string "$VERSION" \
    --username "$APPLE_ID" \
    --password "$APPLE_PASSWORD"
fi
