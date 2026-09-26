#!/bin/sh
cd "$(dirname "$0")" || exit 1
LAUNCHER=$(sh launcher/build-cli.sh) || exit 1
exec "$LAUNCHER" "$@"
