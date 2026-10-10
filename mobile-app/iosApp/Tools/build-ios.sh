#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ios_app_dir="$(cd -- "$script_dir/.." && pwd)"

if [[ -z "${IOS_ARTIFACTS_DIR:-}" ]]; then
  IOS_ARTIFACTS_DIR="$(mktemp -d "${TMPDIR:-/tmp}/claudebot-ios-build.XXXXXX")"
fi
mkdir -p "$IOS_ARTIFACTS_DIR"
IOS_ARTIFACTS_DIR="$(cd -- "$IOS_ARTIFACTS_DIR" && pwd)"
run_dir="$(mktemp -d "$IOS_ARTIFACTS_DIR/run.XXXXXX")"
derived_data=""
archive_derived_data=""

cleanup_temporary_directory() {
  local path="$1"
  python3 - "$path" "$IOS_ARTIFACTS_DIR" <<'PY'
from pathlib import Path
import shutil
import sys

target = Path(sys.argv[1])
base = Path(sys.argv[2]).resolve()
if (target.name.startswith("derived-data.") and target.parent.resolve() == base
        and target.is_dir() and not target.is_symlink()):
    shutil.rmtree(target)
PY
}

cleanup() {
  if [[ -n "$derived_data" ]]; then
    cleanup_temporary_directory "$derived_data"
  fi
  if [[ -n "$archive_derived_data" ]]; then
    cleanup_temporary_directory "$archive_derived_data"
  fi
}
trap cleanup EXIT

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Required command is missing: $1" >&2
    exit 127
  }
}

run_logged() {
  local log_path="$1"
  shift
  "$@" 2>&1 | tee "$log_path"
}

require_command xcodebuild
require_command xcrun
require_command xcodegen
require_command python3
require_command ditto
require_command osascript

if [[ -n "${DEVELOPER_DIR:-}" ]]; then
  [[ -d "$DEVELOPER_DIR" ]] || {
    echo "DEVELOPER_DIR does not exist: $DEVELOPER_DIR" >&2
    exit 1
  }
fi

echo "iOS build artifacts: $run_dir"
osascript -e 'set volume output muted true'
xcodebuild -version

cd "$ios_app_dir"
run_logged "$run_dir/xcodegen.log" xcodegen generate --spec project.yml

simulator_selection="$(xcrun simctl list devices available --json | python3 -c '
import json
import re
import sys

inventory = json.load(sys.stdin)
candidates = []
for runtime, devices in inventory.get("devices", {}).items():
    version_match = re.search(r"iOS-(\d+(?:-\d+)*)", runtime)
    if version_match is None:
        continue
    version = tuple(int(part) for part in version_match.group(1).split("-"))
    for device in devices:
        if device.get("isAvailable") and device.get("name", "").startswith("iPhone"):
            candidates.append((version, device.get("name", ""), runtime, device["udid"]))

if not candidates:
    raise SystemExit("No available iPhone simulator is installed on this runner")

# Prefer the newest installed iOS runtime and then a stable device-name order.
version, name, runtime, udid = max(candidates, key=lambda item: (item[0], item[1]))
print(f"{udid}\t{name}\t{runtime}")
')"
IFS=$'\t' read -r simulator_udid simulator_name simulator_runtime <<< "$simulator_selection"
[[ -n "$simulator_udid" ]] || { echo 'Could not select an iPhone simulator.' >&2; exit 1; }
echo "Using $simulator_name ($simulator_runtime, $simulator_udid)"

derived_data="$(mktemp -d "$IOS_ARTIFACTS_DIR/derived-data.XXXXXX")"
simulator_destination="platform=iOS Simulator,id=$simulator_udid"
run_logged "$run_dir/simulator-build.log" env BLINK_IOS_UI_FIXTURES=YES xcodebuild \
  -project ClaudeBot.xcodeproj \
  -scheme ClaudeBot \
  -destination "$simulator_destination" \
  -parallel-testing-enabled NO \
  'SWIFT_ACTIVE_COMPILATION_CONDITIONS=$(inherited) DEBUG BLINK_IOS_UI_FIXTURES' \
  -derivedDataPath "$derived_data" \
  -resultBundlePath "$run_dir/Blink-Simulator-Build.xcresult" \
  build-for-testing

simulator_app="$derived_data/Build/Products/Debug-iphonesimulator/Blink.app"
[[ -d "$simulator_app" ]] || { echo "Simulator app is missing: $simulator_app" >&2; exit 1; }
ditto -c -k --sequesterRsrc --keepParent "$simulator_app" "$run_dir/Blink-iOS-Simulator.app.zip"

simulator_is_booted="$(xcrun simctl list devices booted --json | python3 -c '
import json
import sys

udid = sys.argv[1]
inventory = json.load(sys.stdin)
is_booted = any(device.get("udid") == udid for devices in inventory.get("devices", {}).values() for device in devices)
print("true" if is_booted else "false")
' "$simulator_udid")"
if [[ "$simulator_is_booted" != true ]]; then
  xcrun simctl boot "$simulator_udid"
fi

python3 - "$simulator_udid" <<'PY'
import subprocess
import sys

try:
    subprocess.run(
        ["xcrun", "simctl", "bootstatus", sys.argv[1], "-b"],
        check=True,
        timeout=180,
    )
except subprocess.TimeoutExpired:
    raise SystemExit("Timed out after 180 seconds waiting for the selected iPhone simulator to boot")
PY

run_logged "$run_dir/simulator-install.log" xcrun simctl install "$simulator_udid" "$simulator_app"
run_logged "$run_dir/simulator-startup.log" xcrun simctl launch "$simulator_udid" me.waveio.claudebot.mobile
sleep 3
run_logged "$run_dir/simulator-screenshot.log" xcrun simctl io "$simulator_udid" screenshot "$run_dir/Blink-iOS-Startup.png"
[[ -s "$run_dir/Blink-iOS-Startup.png" ]] || { echo 'Startup screenshot is missing or empty.' >&2; exit 1; }
run_logged "$run_dir/simulator-terminate.log" xcrun simctl terminate "$simulator_udid" me.waveio.claudebot.mobile

test_result_bundle="$run_dir/Blink-Simulator-Tests.xcresult"
test_status=0
if run_logged "$run_dir/simulator-tests.log" xcodebuild \
  -project ClaudeBot.xcodeproj \
  -scheme ClaudeBot \
  -destination "$simulator_destination" \
  -parallel-testing-enabled NO \
  -test-timeouts-enabled YES \
  -default-test-execution-time-allowance 120 \
  -maximum-test-execution-time-allowance 180 \
  -derivedDataPath "$derived_data" \
  -resultBundlePath "$test_result_bundle" \
  test-without-building; then
  test_status=0
else
  test_status=$?
fi

attachment_status=0
if [[ -d "$test_result_bundle" ]]; then
  mkdir -p "$run_dir/XCTest-Attachments"
  if run_logged "$run_dir/xctest-attachments.log" xcrun xcresulttool export attachments \
    --path "$test_result_bundle" \
    --output-path "$run_dir/XCTest-Attachments"; then
    echo "Exported XCTest attachments to $run_dir/XCTest-Attachments"
  else
    attachment_status=$?
    echo 'Could not export XCTest attachments.' >&2
  fi
else
  attachment_status=1
  echo 'XCTest result bundle is missing; attachments were not exported.' >&2
fi

if (( test_status != 0 )); then
  echo "XCTest failed with exit code $test_status; preserving that result after attachment export." >&2
  exit "$test_status"
fi
if (( attachment_status != 0 )); then
  exit "$attachment_status"
fi

if [[ "${IOS_BUILD_DEVICE_ARCHIVE:-true}" == "true" ]]; then
  archive_derived_data="$(mktemp -d "$IOS_ARTIFACTS_DIR/derived-data.XXXXXX")"
  run_logged "$run_dir/device-archive.log" env BLINK_IOS_UI_FIXTURES=NO xcodebuild \
    -project ClaudeBot.xcodeproj \
    -scheme ClaudeBot \
    -destination 'generic/platform=iOS' \
    -derivedDataPath "$archive_derived_data" \
    -archivePath "$run_dir/Blink-iPhoneOS-UNSIGNED.xcarchive" \
    CODE_SIGNING_ALLOWED=NO \
    archive
  ditto -c -k --sequesterRsrc --keepParent \
    "$run_dir/Blink-iPhoneOS-UNSIGNED.xcarchive" \
    "$run_dir/Blink-iPhoneOS-UNSIGNED.xcarchive.zip"
else
  echo 'Skipping the optional unsigned iPhoneOS archive.'
fi

echo "iOS build and XCTest run completed. Artifacts: $run_dir"
