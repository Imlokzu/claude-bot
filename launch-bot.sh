#!/bin/sh
cd "$(dirname "$0")" || exit 1
if [ -x "Virtual Bot/.venv/bin/python" ]; then
  "Virtual Bot/.venv/bin/python" launcher/launcher.py "$@"
else
  python3 launcher/launcher.py "$@"
fi
