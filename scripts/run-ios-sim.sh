#!/usr/bin/env bash
# Build kami and run it on an iOS simulator.
#
# Usage:
#   scripts/run-ios-sim.sh                  # first booted simulator
#   scripts/run-ios-sim.sh "iPhone Duo"     # by device name
#   scripts/run-ios-sim.sh <UDID>           # by UDID
#
# This replaces `cap run ios`, which is broken on Xcode 27: the Capacitor CLI
# opens the simulator through a hardcoded Developer/Applications/Simulator.app
# path, and Xcode 27 renamed that app to Device Hub and moved it to
# Contents/Applications. Everything here goes through `xcrun simctl` instead,
# which is unaffected by the rename.
set -euo pipefail

cd "$(dirname "$0")/.."

APP_ID="eu.maxwase.kami.ios"
DERIVED="build/ios-sim"

target="${1:-}"
if [[ -z "$target" ]]; then
  udid="$(xcrun simctl list devices booted -j | node -e '
    const d = JSON.parse(require("fs").readFileSync(0, "utf8")).devices;
    const all = Object.values(d).flat();
    process.stdout.write(all.length ? all[0].udid : "");
  ')"
  [[ -n "$udid" ]] || { echo "No booted simulator. Pass a device name or UDID." >&2; exit 1; }
else
  udid="$(xcrun simctl list devices available -j | node -e '
    const arg = process.argv[1];
    const d = JSON.parse(require("fs").readFileSync(0, "utf8")).devices;
    const all = Object.values(d).flat();
    const hit = all.find((x) => x.udid === arg) || all.find((x) => x.name === arg);
    process.stdout.write(hit ? hit.udid : "");
  ' "$target")"
  [[ -n "$udid" ]] || { echo "No simulator matching: $target" >&2; exit 1; }
fi

echo "==> Simulator $udid"
pnpm run ios:sync

echo "==> Booting"
xcrun simctl bootstatus "$udid" -b
open -a "$(xcode-select -p)/../Applications/DeviceHub.app" || true

echo "==> Building"
xcodebuild build \
  -project ios/App/App.xcodeproj \
  -scheme App \
  -configuration Debug \
  -destination "id=$udid" \
  -derivedDataPath "$DERIVED" \
  -quiet

echo "==> Installing"
xcrun simctl install "$udid" "$DERIVED/Build/Products/Debug-iphonesimulator/App.app"

echo "==> Launching"
xcrun simctl launch "$udid" "$APP_ID"
