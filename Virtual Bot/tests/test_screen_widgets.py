"""
Timers and the weather tile: state shared by the bot (tools) and the screen.

"Put a ten minute timer on" is said to the bot but rings on the screen, and
"how long is left?" is asked of the bot about what the screen shows — so
both must read one state, and it must survive a restart.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

import screen_widgets
from tools import registry, timer_tools


@pytest.fixture(autouse=True)
def isolated_state(tmp_path: Path):
    clock = {"now": 1_000_000.0}
    with patch.object(screen_widgets, "_state_path", lambda: tmp_path / "screen-widgets.json"), \
         patch.object(screen_widgets, "_now", lambda: clock["now"]), \
         patch.object(screen_widgets.events, "publish") as publish:
        screen_widgets._weather_cache.clear()
        yield clock, publish


def _run(coro):
    # Not asyncio.run: on Python 3.9 it leaves no current loop behind, and
    # the old TestClient used further down needs one.
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


class TestTimers:
    def test_set_timer_from_minutes_counts_down(self, isolated_state):
        clock, publish = isolated_state
        result = _run(timer_tools.set_timer(minutes=10, label="чай"))
        assert result["ok"] and result["timer"]["seconds"] == 600
        clock["now"] += 125
        [timer] = screen_widgets.list_timers()
        assert timer["label"] == "чай" and timer["state"] == "running"
        assert timer["left"] == pytest.approx(475)
        # The screen hears about it, and switches to the timer tile
        kinds = [c.args[0].get("type") for c in publish.call_args_list]
        assert "timer" in kinds and "screen" in kinds

    def test_status_splits_what_is_left_for_speech(self, isolated_state):
        _run(timer_tools.set_timer(hours=1, minutes=2, seconds=3))
        status = _run(timer_tools.timer_status())
        assert status["timers"][0]["left_parts"] == {"hours": 1, "minutes": 2, "seconds": 3}

    def test_a_rung_timer_is_still_listed_as_done_for_a_while(self, isolated_state):
        clock, _ = isolated_state
        _run(timer_tools.set_timer(seconds=30, label="паста"))
        clock["now"] += 60
        assert screen_widgets.list_timers()[0]["state"] == "done"
        clock["now"] += screen_widgets.DONE_KEEP_S + 1
        assert screen_widgets.list_timers() == []

    def test_pause_freezes_and_resume_continues(self, isolated_state):
        clock, _ = isolated_state
        _run(timer_tools.set_timer(minutes=5))
        clock["now"] += 60
        _run(timer_tools.timer_control("pause"))
        clock["now"] += 600                       # paused time does not count
        assert screen_widgets.list_timers()[0]["left"] == pytest.approx(240)
        _run(timer_tools.timer_control("resume"))
        clock["now"] += 40
        assert screen_widgets.list_timers()[0]["left"] == pytest.approx(200)

    def test_control_by_label_and_cancel_all(self, isolated_state):
        _run(timer_tools.set_timer(minutes=3, label="чай"))
        _run(timer_tools.set_timer(minutes=8, label="паста"))
        added = _run(timer_tools.timer_control("add", label="ПАСТ", minutes=2))
        assert added["changed"][0]["label"] == "паста"
        assert {t["label"]: t["left"] for t in screen_widgets.list_timers()}["паста"] == pytest.approx(600)
        _run(timer_tools.timer_control("cancel", label="чай"))
        assert [t["label"] for t in screen_widgets.list_timers()] == ["паста"]
        _run(timer_tools.timer_control("cancel_all"))
        assert screen_widgets.list_timers() == []

    def test_nonsense_durations_and_unknown_timers_are_errors(self, isolated_state):
        assert "error" in _run(timer_tools.set_timer())
        assert "error" in _run(timer_tools.set_timer(hours=30))
        assert "error" in _run(timer_tools.timer_control("cancel", label="нема"))
        assert "error" in _run(timer_tools.timer_control("explode"))

    def test_timers_survive_a_restart(self, isolated_state, tmp_path: Path):
        _run(timer_tools.set_timer(minutes=1, label="чай"))
        assert (tmp_path / "screen-widgets.json").is_file()
        assert screen_widgets._load()["timers"][0]["label"] == "чай"

    def test_the_brain_sees_the_tools(self):
        assert {"set_timer", "timer_control", "timer_status"} <= registry.tool_names()


class TestTimerApi:
    def test_screen_buttons_drive_the_same_state(self, isolated_state):
        import main

        asyncio.set_event_loop(asyncio.new_event_loop())
        client = TestClient(main.app)
        r = client.post("/api/screen/timers", json={"action": "set", "seconds": 300, "label": "чай"})
        assert r.status_code == 200 and r.json()["timers"][0]["seconds"] == 300
        tid = r.json()["timers"][0]["id"]
        r = client.post("/api/screen/timers", json={"action": "add", "id": tid, "seconds": 60})
        assert r.json()["timers"][0]["left"] == pytest.approx(360)
        assert client.post("/api/screen/timers", json={"action": "set", "seconds": 0}).status_code == 400
        assert client.post("/api/screen/timers", json={"action": "boom"}).status_code == 422


class TestWeatherTile:
    def test_the_tile_shows_what_the_bot_just_looked_up(self, isolated_state):
        _, publish = isolated_state
        answer = {"city": "Львів", "temperature": 12, "condition": "Хмарно", "forecast": []}

        async def fake_get_weather(city):
            return answer

        with patch.object(registry, "get_weather", fake_get_weather):
            _run(registry.execute_tool("weather", {"city": "Львів"}))
        event = publish.call_args.args[0]
        assert event["type"] == "weather" and event["weather"]["temperature"] == 12

    def test_weather_is_cached_between_tile_refreshes(self, isolated_state):
        clock, _ = isolated_state
        calls = []

        async def fake_get_weather(city):
            calls.append(city)
            return {"city": city, "temperature": 5}

        with patch("tools.weather.get_weather", fake_get_weather):
            _run(screen_widgets.weather_now("Kyiv"))
            _run(screen_widgets.weather_now("Kyiv"))
            clock["now"] += screen_widgets.WEATHER_TTL_S + 1
            _run(screen_widgets.weather_now("Kyiv"))
        assert calls == ["Kyiv", "Kyiv"]

    def test_city_is_remembered(self, isolated_state):
        assert screen_widgets.weather_city() == screen_widgets.DEFAULT_CITY
        screen_widgets.set_weather_city("  Львів ")
        assert screen_widgets.weather_city() == "Львів"
        with pytest.raises(ValueError):
            screen_widgets.set_weather_city("   ")
