#!/usr/bin/env bash
# Build a Development-signed, sandboxed .app for local App Sandbox testing.
# Unlike build-appstore.sh, this does NOT embed a Mac App Store distribution
# provisioning profile, so macOS/AMFI will actually let you launch it
# directly (Distribution profiles are only trusted through a real App Store
# install/TestFlight, never ad hoc). Sandbox enforcement itself is identical.

set -euo pipefail
cd "$(dirname "$0")/.."

APP="src-tauri/target/release/bundle/macos/kami.app"

echo "==> Building signed, sandboxed .app (Development identity)"
pnpm tauri build --bundles app --config src-tauri/tauri.sandbox-dev.conf.json

echo "==> Verifying signature"
codesign --verify --deep --strict --verbose=2 "$APP"

echo "==> Built: $APP"
