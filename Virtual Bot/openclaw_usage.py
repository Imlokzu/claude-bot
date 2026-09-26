"""
OpenClaw usage for the panel: subscription quota and what a chat really cost.

OpenClaw owns all of this, so nothing here is estimated. `usage.status` is the
provider's own quota report (for a ChatGPT subscription: the 5-hour and weekly
windows). `sessions.usage` reads one session's transcript and prices every turn
with OpenClaw's model price table, cache reads and writes included, so the
panel can show what the same traffic would cost at API prices even when it
actually runs on a flat subscription. `usage.cost` is the same pricing summed
over recent days.

Everything goes through `openclaw gateway call`, like the rest of the panel's
OpenClaw access: the CLI already knows the gateway address and token.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import json
import logging
import time
from typing import Any

import openclaw_config
import openclaw_models

log = logging.getLogger("virtual_bot.openclaw_usage")

# Quota moves slowly and every call spawns the CLI, so a short cache keeps a
# panel that refetches on every reply from hammering the gateway.
_QUOTA_TTL_S = 60
_TOTALS_TTL_S = 300
_SESSION_DAYS = 30

_cache: dict[str, tuple[float, Any]] = {}

_COST_FIELDS = (
    "input", "output", "cacheRead", "cacheWrite", "totalTokens",
    "totalCost", "inputCost", "outputCost", "cacheReadCost", "cacheWriteCost",
    "missingCostEntries",
)


async def _call(method: str, params: dict | None = None, timeout: float = 30) -> dict | None:
    args = ["gateway", "call", method, "--json"]
    if params:
        args += ["--params", json.dumps(params)]
    code, out, err = await openclaw_models._run_cli(*args, timeout=timeout)
    if code != 0:
        log.warning("openclaw gateway call %s: code %d (%s)", method, code, err.strip()[:160])
        return None
    try:
        data = json.loads(out)
    except ValueError:
        log.warning("openclaw gateway call %s: not JSON", method)
        return None
    return data if isinstance(data, dict) else None


async def _cached(key: str, ttl: float, load) -> Any:
    hit = _cache.get(key)
    if hit and time.monotonic() - hit[0] < ttl:
        return hit[1]
    value = await load()
    # A failed call is not cached: the next refetch should try again.
    if value is not None:
        _cache[key] = (time.monotonic(), value)
    return value


def _costs(raw: dict | None) -> dict:
    raw = raw if isinstance(raw, dict) else {}
    return {field: raw.get(field, 0) or 0 for field in _COST_FIELDS}


async def quota() -> list[dict] | None:
    """Provider quota windows, e.g. ChatGPT Plus: 5h 94% used, week 15%."""
    async def load():
        data = await _call("usage.status")
        if data is None:
            return None
        providers = []
        for item in data.get("providers") or []:
            if not isinstance(item, dict):
                continue
            providers.append({
                "provider": str(item.get("provider") or ""),
                "name": str(item.get("displayName") or item.get("provider") or ""),
                "plan": str(item.get("plan") or ""),
                "windows": [
                    {
                        "label": str(w.get("label") or ""),
                        "used_percent": w.get("usedPercent"),
                        "reset_at": w.get("resetAt"),
                    }
                    for w in item.get("windows") or [] if isinstance(w, dict)
                ],
                "billing": [
                    {"type": str(b.get("type") or ""), "amount": b.get("amount"), "unit": str(b.get("unit") or "")}
                    for b in item.get("billing") or [] if isinstance(b, dict)
                ],
            })
        return providers
    return await _cached("quota", _QUOTA_TTL_S, load)


async def session(key: str) -> dict | None:
    """Tokens and API-priced cost of one OpenClaw session. None if it has no turns yet."""
    today = dt.date.today()
    data = await _call("sessions.usage", {
        "startDate": (today - dt.timedelta(days=_SESSION_DAYS)).isoformat(),
        "endDate": today.isoformat(),
        "key": key,
        "limit": 1,
    })
    rows = (data or {}).get("sessions") or []
    if not rows or not isinstance(rows[0], dict):
        return None
    row = rows[0]
    usage = row.get("usage") if isinstance(row.get("usage"), dict) else {}
    latency = usage.get("latency") if isinstance(usage.get("latency"), dict) else {}
    counts = usage.get("messageCounts") if isinstance(usage.get("messageCounts"), dict) else {}
    tools = usage.get("toolUsage") if isinstance(usage.get("toolUsage"), dict) else {}
    return {
        "model": str(row.get("model") or ""),
        "provider": str(row.get("modelProvider") or ""),
        **_costs(usage),
        "turns": counts.get("assistant", 0) or 0,
        "tool_calls": tools.get("totalCalls", 0) or 0,
        "avg_latency_ms": latency.get("avgMs"),
    }


async def totals() -> dict | None:
    """Last 30 days across every session. OpenClaw indexes transcripts lazily."""
    async def load():
        data = await _call("usage.cost", timeout=45)
        if data is None:
            return None
        status = data.get("cacheStatus") if isinstance(data.get("cacheStatus"), dict) else {}
        return {
            "days": data.get("days"),
            **_costs(data.get("totals")),
            # "refreshing" means the index is still being built: zeros are not real yet.
            "indexing": status.get("status") == "refreshing",
        }
    return await _cached("totals", _TOTALS_TTL_S, load)


async def snapshot(session_key: str | None) -> dict:
    session_task = session(session_key) if session_key else asyncio.sleep(0, result=None)
    quota_value, session_value, totals_value = await asyncio.gather(
        quota(), session_task, totals(), return_exceptions=True,
    )

    def ok(value):
        if isinstance(value, BaseException):
            log.warning("OpenClaw usage part failed: %s", type(value).__name__)
            return None
        return value

    return {
        "model": openclaw_models.get_selected() or str(openclaw_config.get("agents.defaults.model.primary", "") or ""),
        "quota": ok(quota_value),
        "session": ok(session_value),
        "totals": ok(totals_value),
    }
