"""
OpenClaw usage for the panel: subscription quota and what a chat really cost.

OpenClaw owns all of this, so nothing here is estimated. `usage.status` is the
provider's own quota report (for a ChatGPT subscription: the 5-hour and weekly
windows). `sessions.usage` reads one session's transcript and prices every turn
with OpenClaw's model price table, cache reads and writes included, so the
panel can show what the same traffic would cost at API prices even when it
actually runs on a flat subscription. Over a date range the same call also
aggregates by provider, which gives each account's traffic and cost.

Checked against the raw transcript (token sums match exactly) and against
OpenAI's published Standard prices (gpt-6-luna: $0.10 / $0.01 cached / $0.50
per 1M). Models missing from OpenClaw's price table are counted in
`missingCostEntries` rather than priced at zero silently.

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


# Internal delivery bookkeeping, not a model account.
_INTERNAL_PROVIDERS = {"openclaw"}


async def _configured_providers() -> dict[str, str] | None:
    """Provider -> auth kind for every account OpenClaw holds credentials for.

    Only the kind leaves this function; the profile labels carry masked keys
    and e-mail addresses and are never passed on.
    """
    code, out, err = await openclaw_models._run_cli("models", "status", "--json", timeout=45)
    if code != 0:
        log.warning("openclaw models status: code %d (%s)", code, err.strip()[:160])
        return None
    try:
        auth = (json.loads(out).get("auth") or {})
    except (ValueError, AttributeError):
        return None
    kinds: dict[str, str] = {}
    for item in auth.get("providers") or []:
        if not isinstance(item, dict) or not item.get("provider"):
            continue
        profiles = item.get("profiles") if isinstance(item.get("profiles"), dict) else {}
        kind = "oauth" if profiles.get("oauth") else "api_key" if profiles.get("apiKey") else "token"
        kinds[str(item["provider"])] = kind
    return kinds


async def accounts() -> dict | None:
    """Every provider account with its last-30-days traffic, priced at API rates."""
    async def load():
        today = dt.date.today()
        usage, configured = await asyncio.gather(
            _call("sessions.usage", {
                "startDate": (today - dt.timedelta(days=_SESSION_DAYS)).isoformat(),
                "endDate": today.isoformat(),
                "agentScope": "all",
                # Aggregates cover the whole range whatever the limit; one row keeps the payload small.
                "limit": 1,
            }, timeout=60),
            _configured_providers(),
        )
        if usage is None:
            return None
        aggregates = usage.get("aggregates") if isinstance(usage.get("aggregates"), dict) else {}
        by_provider = {
            str(item.get("provider")): item
            for item in aggregates.get("byProvider") or []
            if isinstance(item, dict) and item.get("provider")
        }
        names = (set(configured or {}) | set(by_provider)) - _INTERNAL_PROVIDERS
        rows = []
        for name in names:
            item = by_provider.get(name) or {}
            rows.append({
                "provider": name,
                "auth": (configured or {}).get(name, ""),
                "replies": item.get("count", 0) or 0,
                **_costs(item.get("totals")),
            })
        rows.sort(key=lambda row: (-row["replies"], row["provider"]))
        status = usage.get("cacheStatus") if isinstance(usage.get("cacheStatus"), dict) else {}
        return {
            "days": _SESSION_DAYS,
            "accounts": rows,
            "totals": _costs(usage.get("totals")),
            # "refreshing" means the index is still being built: zeros are not real yet.
            "indexing": status.get("status") == "refreshing",
        }
    return await _cached("accounts", _TOTALS_TTL_S, load)


def _ok(value):
    if isinstance(value, BaseException):
        log.warning("OpenClaw usage part failed: %s", type(value).__name__)
        return None
    return value


async def accounts_snapshot() -> dict:
    quota_value, accounts_value = await asyncio.gather(quota(), accounts(), return_exceptions=True)
    quota_list = _ok(quota_value) or []
    data = _ok(accounts_value) or {"days": _SESSION_DAYS, "accounts": [], "totals": None, "indexing": False}
    quotas = {item["provider"]: item for item in quota_list}
    for row in data["accounts"]:
        row["quota"] = quotas.pop(row["provider"], None)
    # A provider with a quota report but no traffic in the range is still an account.
    for provider, item in quotas.items():
        data["accounts"].insert(0, {"provider": provider, "auth": "", "replies": 0, **_costs(None), "quota": item})
    data["accounts"].sort(key=lambda row: (row.get("quota") is None, -row["replies"], row["provider"]))
    data["available"] = accounts_value is not None and not isinstance(accounts_value, BaseException)
    return data


async def chat_snapshot(session_key: str | None) -> dict:
    value = await asyncio.gather(
        session(session_key) if session_key else asyncio.sleep(0, result=None),
        return_exceptions=True,
    )
    return {
        "model": openclaw_models.get_selected() or str(openclaw_config.get("agents.defaults.model.primary", "") or ""),
        "session": _ok(value[0]),
    }
