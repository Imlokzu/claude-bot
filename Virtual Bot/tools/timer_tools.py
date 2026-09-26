"""
Timer tools: "put a ten minute timer on", "how long is left?", "cancel it".

The timer ticks on the device screen (a tile of its own) and rings there;
the state is shared with the screen through screen_widgets. Durations come
from the model as numbers, never as phrases: "півтори хвилини" is the
model's job to turn into 90, parsing Ukrainian numerals here would only be
a worse copy of what it already does well.
"""

from __future__ import annotations

import logging

import screen_widgets

log = logging.getLogger("virtual_bot.tools.timer")


def _seconds(hours: float = 0, minutes: float = 0, seconds: float = 0) -> float:
    return float(hours or 0) * 3600 + float(minutes or 0) * 60 + float(seconds or 0)


def _spoken_left(left: float) -> dict:
    """Split for the model to say aloud; it words the numbers itself."""
    left = int(round(left))
    return {"hours": left // 3600, "minutes": left % 3600 // 60, "seconds": left % 60}


async def set_timer(hours: float = 0, minutes: float = 0, seconds: float = 0, label: str = "") -> dict:
    total = _seconds(hours, minutes, seconds)
    try:
        timer = screen_widgets.add_timer(total, label)
    except ValueError as exc:
        return {"error": str(exc)}
    screen_widgets.events.publish_screen("timer")
    log.info("⏲ Timer %ss «%s»", timer["seconds"], timer["label"])
    return {"ok": True, "timer": timer, "left": _spoken_left(timer["left"])}


async def timer_control(action: str, label: str = "", minutes: float = 0, seconds: float = 0) -> dict:
    action = str(action or "").strip().lower()
    if action not in ("cancel", "cancel_all", "pause", "resume", "add"):
        return {"error": "action must be one of cancel, cancel_all, pause, resume, add"}
    key = "all" if action == "cancel_all" else label
    changed = screen_widgets.update_timer(
        "cancel" if action == "cancel_all" else action, key, _seconds(0, minutes, seconds),
    )
    if not changed:
        return {"error": "no such timer", "timers": screen_widgets.list_timers()}
    return {"ok": True, "changed": changed, "timers": screen_widgets.list_timers()}


async def timer_status() -> dict:
    timers = screen_widgets.list_timers()
    return {
        "timers": [{**t, "left_parts": _spoken_left(t["left"])} for t in timers],
        "count": len(timers),
    }


SCHEMAS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "set_timer",
            "description": (
                "Start a countdown timer on the bot's screen; it rings there when done. "
                "Use for «постав таймер на 10 хвилин», «нагадай через пів години про чай». "
                "Give the duration as numbers (90 seconds, not a phrase)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "hours": {"type": "number"},
                    "minutes": {"type": "number"},
                    "seconds": {"type": "number"},
                    "label": {"type": "string", "description": "What it is for, a word or two: «чай», «паста»."},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "timer_control",
            "description": (
                "Change running timers: cancel one (by label, or the nearest if no label), "
                "cancel_all, pause, resume, or add minutes/seconds to one."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["cancel", "cancel_all", "pause", "resume", "add"]},
                    "label": {"type": "string"},
                    "minutes": {"type": "number"},
                    "seconds": {"type": "number"},
                },
                "required": ["action"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "timer_status",
            "description": "Which timers are running and how long each has left.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
]

HANDLERS = {
    "set_timer": set_timer,
    "timer_control": timer_control,
    "timer_status": timer_status,
}
