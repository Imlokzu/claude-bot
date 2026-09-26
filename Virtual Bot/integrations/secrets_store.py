"""
Where integrations keep their tokens and small state.

One JSON file per integration under `runtime/integrations/` (git-ignored with
the rest of runtime/), written atomically with 0600 permissions: these files
hold bot tokens and OAuth refresh tokens, and a half-written file would lose
a working login.

`VBOT_INTEGRATIONS_DIR` moves the folder. Tests point it at a temp dir, which
also guarantees a test run never starts a poller with the owner's real token.
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from threading import Lock
from typing import Any

import app_config

_lock = Lock()


def base_dir() -> Path:
    override = os.environ.get("VBOT_INTEGRATIONS_DIR", "").strip()
    if override:
        return Path(override)
    return Path(app_config.BASE_DIR) / "runtime" / "integrations"


def _path(name: str) -> Path:
    if not name.replace("_", "").replace("-", "").isalnum():
        raise ValueError("bad integration name")
    return base_dir() / f"{name}.json"


def load(name: str) -> dict[str, Any]:
    try:
        data = json.loads(_path(name).read_text("utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def save(name: str, data: dict[str, Any]) -> None:
    path = _path(name)
    with _lock:
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            os.chmod(path.parent, 0o700)
        except OSError:
            pass
        fd, tmp = tempfile.mkstemp(prefix=f".{name}-", dir=path.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(data, handle, ensure_ascii=False, indent=2)
            os.chmod(tmp, 0o600)
            os.replace(tmp, path)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise


def update(name: str, **fields: Any) -> dict[str, Any]:
    """Merge fields into the stored dict; a None value deletes the key."""
    data = load(name)
    for key, value in fields.items():
        if value is None:
            data.pop(key, None)
        else:
            data[key] = value
    save(name, data)
    return data


def clear(name: str) -> None:
    with _lock:
        try:
            _path(name).unlink()
        except FileNotFoundError:
            pass


def mask(secret: str) -> str:
    """Enough of a token to recognise it in the UI, never enough to use it."""
    secret = str(secret or "")
    if len(secret) <= 8:
        return "•" * len(secret)
    return secret[:4] + "…" + secret[-4:]
