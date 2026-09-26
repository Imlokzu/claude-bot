"""
YouTube Music: the Python side of the Rust helper.

The helper itself is exercised live only when it is built (`cargo build
--release` in ytm-helper/) and the network is up; everything else runs
against a fake helper script, so the contract — argv, JSON, errors, cache,
the Now Playing queue — is pinned without YouTube.
"""

from __future__ import annotations

import asyncio
import json
import os
import stat
import sys

import pytest
from fastapi.testclient import TestClient

import events
import ytmusic


@pytest.fixture()
def fake_helper(tmp_path, monkeypatch):
    """A stand-in helper that echoes its argv and fails on demand."""
    script = tmp_path / "ytm-helper"
    script.write_text(
        # env, not sys.executable: the repo path has a space, and a shebang
        # cannot hold one.
        "#!/usr/bin/env python3\n"
        "import json, sys\n"
        "args = sys.argv[1:]\n"
        "cmd = args[2] if len(args) > 2 else ''\n"
        "arg = args[3] if len(args) > 3 and not args[3].startswith('--') else ''\n"
        "if arg == 'boom':\n"
        "    print(json.dumps({'error': 'upstream said no'})); sys.exit(1)\n"
        "if cmd == 'charts':\n"
        "    print(json.dumps({'tracks': [], 'trending': []})); sys.exit(0)\n"
        "if cmd == 'new':\n"
        "    print(json.dumps({'albums': [{'id': 'MPREb_x', 'title': 'Fresh'}], 'tracks': []})); sys.exit(0)\n"
        "print(json.dumps({'tracks': [{'id': 'dQw4w9WgXcQ', 'title': 't', 'artists': ['A', 'B'], 'duration': 212}], 'argv': args}))\n"
    )
    script.chmod(script.stat().st_mode | stat.S_IXUSR)
    monkeypatch.setenv("YTM_HELPER", str(script))
    ytmusic._CACHE.clear()
    return script


def test_run_passes_query_as_one_argument(fake_helper):
    """The query is an argv element, never shell text."""
    data = asyncio.run(ytmusic.run("search", "a; rm -rf / $(x)", 5))
    assert data["argv"][2:4] == ["search", "a; rm -rf / $(x)"]
    assert data["argv"][-2:] == ["--limit", "5"]


def test_run_errors_are_typed(fake_helper):
    with pytest.raises(ytmusic.YtmError) as err:
        asyncio.run(ytmusic.run("search", "boom"))
    assert err.value.code == "upstream"
    with pytest.raises(ytmusic.YtmError):
        asyncio.run(ytmusic.run("rm", "x"))


def test_run_is_cached(fake_helper):
    first = asyncio.run(ytmusic.run("search", "Same"))
    fake_helper.write_text("#!/bin/sh\nexit 3\n")  # a second call would now fail
    assert asyncio.run(ytmusic.run("search", "same")) == first


def test_missing_helper_says_so(monkeypatch, tmp_path):
    monkeypatch.setenv("YTM_HELPER", str(tmp_path / "nope"))
    monkeypatch.setattr(ytmusic, "helper_path", lambda: None)
    ytmusic._CACHE.clear()
    with pytest.raises(ytmusic.YtmError) as err:
        asyncio.run(ytmusic.run("search", "x"))
    assert err.value.code == "unavailable"


def test_home_survives_empty_charts(fake_helper):
    home = asyncio.run(ytmusic.home("UA"))
    assert home["charts"] == [] and home["new_albums"][0]["title"] == "Fresh"


def test_as_now_playing_shape():
    track = ytmusic.as_now_playing({"id": "dQw4w9WgXcQ", "title": "t", "artists": ["A", "B"], "duration": 3})
    assert track == {"provider": "youtube", "id": "dQw4w9WgXcQ", "title": "t", "uploader": "A, B",
                     "duration": 3, "source": "ytmusic"}


def test_api_and_up_next_queue(fake_helper, monkeypatch):
    # asyncio.run() in the tests above closed the default loop, and on py3.9
    # importing main creates module-level asyncio.Lock()s that ask for one.
    asyncio.set_event_loop(asyncio.new_event_loop())
    from main import app

    published = []
    monkeypatch.setattr(events, "publish", lambda event: published.append(event))
    with TestClient(app) as client:
        found = client.get("/api/ytm/search", params={"q": "x"})
        assert found.status_code == 200 and found.json()["tracks"][0]["id"] == "dQw4w9WgXcQ"
        assert client.get("/api/ytm/radio", params={"id": "../etc"}).status_code == 400
        assert client.get("/api/ytm/search").status_code == 400
        assert client.get("/api/ytm/shell").status_code == 404
        assert client.get("/api/ytm/cover", params={"u": "https://evil.example/x.jpg"}).status_code == 400

        played = client.post("/api/music/play", json={
            "id": "dQw4w9WgXcQ", "title": "now",
            "queue": [{"id": "jNQXAC9IVRw", "title": "next"}],
        })
        assert played.status_code == 200 and played.json()["queue"] == 1
    music_events = [e for e in published if e.get("type") == "music"]
    assert music_events[-1]["queue"][0]["id"] == "jNQXAC9IVRw"


@pytest.mark.skipif(not ytmusic.helper_path() or os.environ.get("VBOT_OFFLINE") == "1",
                    reason="ytm-helper not built or offline")
def test_live_helper_search():
    """The real binary against real YouTube Music (skipped when not built)."""
    ytmusic._CACHE.clear()
    data = asyncio.run(ytmusic.run("search", "Daft Punk Get Lucky", 3))
    assert data["tracks"] and len(data["tracks"][0]["id"]) == 11


def test_play_music_tool_prefers_ytmusic(fake_helper, monkeypatch):
    """The brain's play_music goes through YouTube Music and hands over up next."""
    from tools import music_tools

    published = []
    monkeypatch.setattr(events, "publish", lambda event: published.append(event))
    result = asyncio.run(music_tools.play_music("anything"))
    assert result["source"] == "YouTube Music" and result["up_next"] >= 1
    assert published[-1]["track"]["uploader"] == "A, B"


def test_play_music_tool_falls_back_without_helper(monkeypatch):
    from tools import music_tools

    monkeypatch.setattr(ytmusic, "helper_path", lambda: None)

    async def fake_search(query, limit=3):
        return [{"id": "dQw4w9WgXcQ", "title": "yt", "uploader": "u", "provider": "youtube"}]

    monkeypatch.setattr(music_tools.music, "search", fake_search)
    monkeypatch.setattr(events, "publish", lambda event: None)
    result = asyncio.run(music_tools.play_music("anything"))
    assert result["ok"] and "source" not in result
