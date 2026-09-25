#!/usr/bin/env bash
# Build, sign, and package kami for the iOS App Store.
# The macOS counterpart is scripts/build-appstore.sh; see RELEASING.md.
#
# Usage:
#   scripts/build-ios.sh           # build + sign + export .ipa only
#   scripts/build-ios.sh --upload  # also upload the .ipa via altool
#
# --upload reads APPLE_ID and APPLE_PASSWORD from .env (see .env.example).
#
# One-time prerequisites (not scriptable):
#   - An app record in App Store Connect for eu.maxwase.kami.ios. altool picks
#     the listing from the .ipa's bundle ID, so no App Apple ID is needed here.
#   - Xcode signed in to the team account (Settings > Accounts), so export can
#     create the App Store distribution certificate and profile on demand.

set -euo pipefail
cd "$(dirname "$0")/.."

TEAM_ID="YX238Y6233"
PROJECT="ios/App/App.xcodeproj"
SCHEME="App"
ARCHIVE="build/ios/kami.xcarchive"
EXPORT_DIR="build/ios/export"
EXPORT_OPTIONS="ios/ExportOptions.plist"

UPLOAD=false
for arg in "$@"; do
  case "$arg" in
    --upload) UPLOAD=true ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

echo "==> Building web bundle and syncing into the Xcode project"
pnpm ios:sync

# HINGE_DISABLED=1 compiles out the capacitor-hinge UIHingeInteraction code,
# which needs the iOS 27.1 SDK. Set it when archiving with an older Xcode
# (e.g. stable 27.0 via DEVELOPER_DIR); the app then reports no hinge.
SWIFT_CONDITIONS='$(inherited)'
if [ -n "${HINGE_DISABLED:-}" ]; then
  SWIFT_CONDITIONS="$SWIFT_CONDITIONS HINGE_DISABLED"
fi

echo "==> Archiving"
rm -rf "$ARCHIVE" "$EXPORT_DIR"
mkdir -p build/ios
# Capacitor 8 uses SwiftPM, not CocoaPods, so this is -project (no workspace).
# Archived unsigned: automatic signing would first want an iOS Development
# profile, which can't exist without a registered device. Export signs it.
xcodebuild \
  -project "$PROJECT" \
  -scheme "$SCHEME" \
  -configuration Release \
  -destination "generic/platform=iOS" \
  -archivePath "$ARCHIVE" \
  DEVELOPMENT_TEAM="$TEAM_ID" \
  CODE_SIGNING_ALLOWED=NO \
  SWIFT_ACTIVE_COMPILATION_CONDITIONS="$SWIFT_CONDITIONS" \
  archive

echo "==> Exporting signed .ipa"
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportOptionsPlist "$EXPORT_OPTIONS" \
  -exportPath "$EXPORT_DIR" \
  -allowProvisioningUpdates

IPA=$(find "$EXPORT_DIR" -name "*.ipa" -maxdepth 1 | head -1)
if [ -z "$IPA" ]; then
  echo "Export produced no .ipa" >&2
  exit 1
fi
echo "==> Built: $IPA"

# Catches most rejections (missing icons, bad plist keys, unsigned frameworks)
# before a real upload burns a build number.
if [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_PASSWORD:-}" ]; then
  echo "==> Validating"
  xcrun altool --validate-app -f "$IPA" --type ios \
    --username "$APPLE_ID" \
    --password "$APPLE_PASSWORD"
else
  echo "==> Skipping validation (needs .env credentials)"
fi

if [ "$UPLOAD" = true ]; then
  : "${APPLE_ID:?APPLE_ID not set in .env}"
  : "${APPLE_PASSWORD:?APPLE_PASSWORD not set in .env}"

  echo "==> Uploading $IPA to App Store Connect"
  xcrun altool --upload-app -f "$IPA" \
    --type ios \
    --username "$APPLE_ID" \
    --password "$APPLE_PASSWORD"
fi
