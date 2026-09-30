#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."
device="${LYJWPAGE_SIMULATOR:-$(xcrun simctl list devices booted -j | python3 -c 'import json,sys; print(next((d["udid"] for devices in json.load(sys.stdin)["devices"].values() for d in devices if d["state"] == "Booted"), ""))')}"
if [[ -z "$device" ]]; then
  echo "Boot an iOS simulator or set LYJWPAGE_SIMULATOR to its UDID." >&2
  exit 1
fi
if ! curl --fail --silent http://localhost:8788/api/dev/overrides | python3 -c 'import json,sys; assert json.load(sys.stdin)["enabled"]'; then
  echo "Start pnpm dev:worker with DEV_OVERRIDES=true, then enable pnpm dev:override --on." >&2
  exit 1
fi
proxy_pid=""
if ! curl --fail --silent 'http://localhost:8790/api/lyrics?song=1490256995' >/dev/null; then
  node Tools/simulator-test-proxy.mjs &
  proxy_pid=$!
fi
trap 'if [[ -n "$proxy_pid" ]]; then kill "$proxy_pid" 2>/dev/null || true; fi' EXIT
result="${LYJWPAGE_TEST_RESULT:-${TMPDIR:-/tmp}/lyjwpage-ios-tests-$(date +%Y%m%d-%H%M%S).xcresult}"

xcrun simctl boot "$device" 2>/dev/null || true
xcrun simctl bootstatus "$device" -b
xcrun simctl spawn "$device" defaults write com.liangyangjunwei.iPhoneTelemetryHub module.activity.enabled -bool false
xcrun simctl spawn "$device" defaults write com.liangyangjunwei.iPhoneTelemetryHub module.workouts.enabled -bool false
xcodegen generate
xcodebuild -project Lyjwpage.xcodeproj -scheme Lyjwpage \
  -destination "platform=iOS Simulator,id=$device" \
  -derivedDataPath "${TMPDIR:-/tmp}/lyjwpage-ios-simulator" \
  -resultBundlePath "$result" -collect-test-diagnostics never "$@" test
