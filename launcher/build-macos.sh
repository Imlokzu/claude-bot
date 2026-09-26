#!/bin/sh
# Build a small AppKit application; no package manager or runtime downloads.
set -eu
LAUNCHER_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# The window only drives the Go helper; build it first so a click never fails.
sh "$LAUNCHER_DIR/build-cli.sh" >/dev/null
APP_DIR="$LAUNCHER_DIR/build/Claude Bot Launcher.app"
EXECUTABLE="$APP_DIR/Contents/MacOS/ClaudeBotLauncher"
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources"
if [ ! -x "$EXECUTABLE" ] || [ "$LAUNCHER_DIR/macos/Launcher.swift" -nt "$EXECUTABLE" ] ||
   [ "$LAUNCHER_DIR/build-macos.sh" -nt "$EXECUTABLE" ] || [ "$LAUNCHER_DIR/macos/Info.plist" -nt "$EXECUTABLE" ]; then
  # Match Info.plist instead of silently requiring the build host's macOS version.
  LAUNCHER_ARCH=$(uname -m)
  xcrun swiftc "$LAUNCHER_DIR/macos/Launcher.swift" -target "$LAUNCHER_ARCH-apple-macos11.0" -o "$EXECUTABLE" -framework AppKit
fi
cp "$LAUNCHER_DIR/macos/Info.plist" "$APP_DIR/Contents/Info.plist"
cp "$LAUNCHER_DIR/locales.json" "$APP_DIR/Contents/Resources/locales.json"
printf '%s\n' "$APP_DIR"
