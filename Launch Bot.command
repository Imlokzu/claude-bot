#!/bin/sh
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if [ "$#" -eq 0 ]; then
  APP_DIR=$(sh launcher/build-macos.sh) || exit 1
  exec open "$APP_DIR"
fi
LAUNCHER=$(sh launcher/build-cli.sh) || exit 1
exec "$LAUNCHER" "$@"
