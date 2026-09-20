#!/bin/sh
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if [ -x "Virtual Bot/.venv/bin/python" ]; then
  "Virtual Bot/.venv/bin/python" launcher/launcher.py "$@"
else
  python3 launcher/launcher.py "$@"
fi
