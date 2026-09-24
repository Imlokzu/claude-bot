#!/bin/sh
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if [ "$#" -eq 0 ]; then
  APP_DIR=$(sh launcher/build-macos.sh) || exit 1
  exec open "$APP_DIR"
fi
if [ -x "Virtual Bot/.venv/bin/python" ]; then
  "Virtual Bot/.venv/bin/python" launcher/launcher.py "$@"
else
  python3 launcher/launcher.py "$@"
fi
