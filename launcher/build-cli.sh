#!/bin/sh
# Build the Go launcher when its sources are newer than the binary, then print
# the binary path. Needs only the Go toolchain; no modules are downloaded.
set -eu
LAUNCHER_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BINARY="$LAUNCHER_DIR/build/claude-bot-launcher"
stale=0
if [ ! -x "$BINARY" ]; then
  stale=1
else
  for source in "$LAUNCHER_DIR"/*.go "$LAUNCHER_DIR/go.mod" "$LAUNCHER_DIR/locales.json" "$LAUNCHER_DIR/picker.ps1"; do
    if [ "$source" -nt "$BINARY" ]; then stale=1; fi
  done
fi
# Without Go, an existing (possibly older) binary still beats failing outright.
if [ "$stale" -eq 1 ] && { command -v go >/dev/null 2>&1 || [ ! -x "$BINARY" ]; }; then
  mkdir -p "$LAUNCHER_DIR/build"
  (cd "$LAUNCHER_DIR" && go build -trimpath -ldflags="-s -w" -o "$BINARY" .)
fi
printf '%s\n' "$BINARY"
