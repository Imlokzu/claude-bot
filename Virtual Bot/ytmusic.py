"""
YouTube Music for the bot: what to play, not how to play it.

Metadata (search, albums, playlists, radio / up next, lyrics, new releases,
charts) comes from `ytm-helper`, a ~4 MB Rust program on top of rustypipe
(see ytm-helper/README.md). Audio does NOT: a YouTube Music track is an
ordinary YouTube video id, so it plays through the stream proxy the screen
already uses (`/api/music/stream`), with the same fallbacks and caching.

Why a separate binary instead of a Python library: the helper is small,
starts in milliseconds, keeps the (GPL) rustypipe code in its own process,
and the same file cross-compiles for the Pi. When it is missing, every call
here says so plainly and the rest of the bot is unaffected.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import time
from pathlib import Path
from typing import Any

import app_config

log = logging.getLogger("virtual_bot.ytmusic")

_TIMEOUT_S = 25
_CACHE: dict[tuple, tuple[float, Any]] = {}
# Search and albums do not change within minutes; radio and charts are
# allowed to move a little faster.
_TTL = {"search": 900, "albums": 900, "album": 3600, "playlist": 900, "radio": 600,
        "lyrics": 86400, "new": 1800, "charts": 1800}
COMMANDS = tuple(_TTL)


class YtmError(RuntimeError):
    """A handled failure; `code` is stable for clients."""

    def __init__(self, message: str, code: str = "ytm_error") -> None:
        super().__init__(message)
        self.code = code


def helper_path() -> str | None:
    """config music.ytm_helper -> $YTM_HELPER -> the local release build -> PATH."""
    configured = app_config.cfg("music", "ytm_helper", default=None) or os.environ.get("YTM_HELPER")
    candidates = [configured] if configured else []
    candidates.append(str(Path(app_config.BASE_DIR) / "ytm-helper" / "target" / "release" / "ytm-helper"))
    for candidate in candidates:
        if candidate and Path(candidate).is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
    return shutil.which("ytm-helper")


def storage_dir() -> Path:
    # rustypipe caches client versions here; runtime/ is git-ignored.
    path = Path(app_config.BASE_DIR) / "runtime" / "ytm-helper"
    path.mkdir(parents=True, exist_ok=True)
    return path


def available() -> bool:
    return helper_path() is not None


async def run(command: str, arg: str = "", limit: int = 20) -> dict[str, Any]:
    """Run one helper command and return its JSON. Cached per (command, arg)."""
    if command not in COMMANDS:
        raise YtmError("unknown command", "bad_request")
    arg = (arg or "").strip()[:200]
    limit = max(1, min(50, int(limit)))
    key = (command, arg.lower(), limit)
    cached = _CACHE.get(key)
    if cached and time.monotonic() - cached[0] < _TTL[command]:
        return cached[1]

    binary = helper_path()
    if not binary:
        raise YtmError("ytm-helper is not built (cargo build --release in ytm-helper/)", "unavailable")
    argv = [binary, "--storage", str(storage_dir()), command]
    if arg:
        argv.append(arg)
    argv += ["--limit", str(limit)]
    # A list of args, never a shell: `arg` is whatever someone typed.
    proc = await asyncio.create_subprocess_exec(
        *argv, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout=_TIMEOUT_S)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        raise YtmError("YouTube Music did not answer in time", "timeout") from None
    try:
        data = json.loads(out.decode("utf-8", errors="replace") or "{}")
    except ValueError:
        log.warning("ytm-helper %s: unreadable output (%s)", command, err[:200])
        raise YtmError("unreadable helper output", "bad_output") from None
    if proc.returncode != 0 or "error" in data:
        message = str(data.get("error") or err.decode("utf-8", "replace")[:200] or "helper failed")
        log.warning("ytm-helper %s %r failed: %s", command, arg[:60], message)
        raise YtmError(message, "upstream")
    _CACHE[key] = (time.monotonic(), data)
    if len(_CACHE) > 300:
        oldest = sorted(_CACHE, key=lambda k: _CACHE[k][0])[:100]
        for k in oldest:
            _CACHE.pop(k, None)
    return data


def as_now_playing(track: dict[str, Any]) -> dict[str, Any]:
    """Helper track -> the Now Playing track shape the screen already plays."""
    return {
        "provider": "youtube",
        "id": str(track.get("id") or ""),
        "title": str(track.get("title") or ""),
        "uploader": ", ".join(track.get("artists") or []),
        "duration": int(track.get("duration") or 0),
        "source": "ytmusic",
    }


async def home(country: str = "") -> dict[str, Any]:
    """Home shelf: charts when YouTube returns them, new releases always.

    The chart track lists come back empty on the current rustypipe for some
    regions, so the shelf must not depend on them.
    """
    results = await asyncio.gather(
        run("charts", country, 12), run("new", "", 12), return_exceptions=True,
    )
    charts, fresh = (r if isinstance(r, dict) else {} for r in results)
    if not charts and not fresh:
        raise results[0] if isinstance(results[0], Exception) else YtmError("no data", "upstream")
    return {
        "charts": charts.get("tracks") or [],
        "trending": charts.get("trending") or [],
        "new_albums": fresh.get("albums") or [],
        "new_tracks": fresh.get("tracks") or [],
    }
