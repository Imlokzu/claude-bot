"""Common pytest fixtures."""

import sys
from pathlib import Path

# Make src package importable when running tests without editable install
_SRC = Path(__file__).resolve().parent.parent / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))
