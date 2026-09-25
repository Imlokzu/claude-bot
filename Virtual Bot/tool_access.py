"""
«Клод Бот» — tool access: which bot tools the OpenClaw agent is allowed to call.

Why this exists. OpenClaw runs a `minimal` tool profile: only names listed in
`tools.alsoAllow` (~/.openclaw/openclaw.json) reach the agent. A tool that an
MCP bridge declares but the allowlist omits is filtered out before the agent
ever sees it. That is a silent failure mode — `listen_to_video` was declared,
worked when called directly, and the bot still answered that it had no video
tool, because the gateway dropped it on the way.

So the switch lives in two places: the bridge must declare the tool, and the
allowlist must permit it. This module is the panel's side of that switch — it
reads what the bridges declare, marks what is permitted, and flips it.

Changing the allowlist only takes effect once OpenClaw rebuilds its MCP
runtimes, so callers ask for a reload after writing.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import emotions_mcp
import openclaw_config
import tools_mcp
import workspace_mcp

log = logging.getLogger("virtual_bot.tool_access")

CONFIG_PATH = openclaw_config.config_path()

# Tools that act outside this machine or destroy data. The panel warns before
# switching these on; nothing is blocked, but an accidental tap should not
# quietly grant the agent the ability to publish or delete.
SENSITIVE = {
    "tools__share_site",
    "tools__unshare_site",
    "workspace__workspace_delete",
    "workspace__workspace_write",
}

# Server name in OpenClaw config → tool schemas that bridge declares.
def _bridges() -> list[tuple[str, list[dict]]]:
    return [
        ("tools", list(tools_mcp.TOOLS)),
        ("workspace", list(workspace_mcp.TOOLS)),
        ("emotions", [emotions_mcp.TOOL]),
    ]


def _read_config() -> dict:
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


def _allowed(config: dict) -> list[str]:
    tools = config.get("tools")
    if not isinstance(tools, dict):
        return []
    allow = tools.get("alsoAllow")
    return [str(name) for name in allow] if isinstance(allow, list) else []


def catalog() -> dict:
    """Every tool the bridges declare, with whether the agent may call it."""
    try:
        config = _read_config()
    except Exception as exc:  # noqa: BLE001 — another app owns this file
        log.warning("Не вдалося прочитати конфіг OpenClaw: %s", type(exc).__name__)
        return {"profile": "", "readable": False, "groups": []}

    allowed = set(_allowed(config))
    profile = str((config.get("tools") or {}).get("profile") or "")

    groups = []
    for server, schemas in _bridges():
        items = []
        for schema in schemas:
            name = str(schema.get("name") or "")
            if not name:
                continue
            qualified = f"{server}__{name}"
            items.append({
                "name": name,
                "qualified": qualified,
                "description": str(schema.get("description") or "")[:300],
                "enabled": qualified in allowed,
                "sensitive": qualified in SENSITIVE,
            })
        items.sort(key=lambda item: item["name"])
        groups.append({"server": server, "tools": items})
    return {"profile": profile, "readable": True, "groups": groups}


def _write_config(config: dict) -> None:
    """Replace the config atomically, keeping one backup of what was there.

    The file belongs to another application that may be running: a partial
    write would leave the gateway without a config at all, so the new content
    lands under a temporary name and is moved into place in one step.
    """
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    if CONFIG_PATH.exists():
        shutil.copy2(CONFIG_PATH, CONFIG_PATH.with_suffix(".json.bak-panel"))
    body = json.dumps(config, ensure_ascii=False, indent=2) + "\n"
    handle = tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", dir=str(CONFIG_PATH.parent),
        prefix=".openclaw-", suffix=".tmp", delete=False,
    )
    try:
        with handle as out:
            out.write(body)
            out.flush()
            os.fsync(out.fileno())
        os.replace(handle.name, CONFIG_PATH)
    except Exception:
        Path(handle.name).unlink(missing_ok=True)
        raise


def reload_gateway() -> bool:
    """Ask OpenClaw to drop cached MCP runtimes so the new allowlist applies.

    This is not a restart: the gateway keeps running and picks the change up
    on the next turn. Failure is not fatal — the config is already written,
    and the agent gets the tool once its runtime is rebuilt anyway.
    """
    try:
        done = subprocess.run(
            ["openclaw", "mcp", "reload"],
            capture_output=True, text=True, timeout=60, check=False,
        )
        if done.returncode != 0:
            log.warning("openclaw mcp reload: код %d", done.returncode)
        return done.returncode == 0
    except Exception as exc:  # noqa: BLE001 — CLI може бути відсутнім
        log.warning("Не вдалося перезавантажити MCP: %s", type(exc).__name__)
        return False


def set_enabled(qualified: str, enabled: bool) -> dict:
    """Allow or forbid one tool. Returns {'ok': True, 'reloaded': bool}."""
    qualified = str(qualified or "").strip()
    known = {item["qualified"] for group in catalog()["groups"] for item in group["tools"]}
    if qualified not in known:
        return {"error": f"Невідомий інструмент: {qualified}"}

    try:
        config = _read_config()
    except Exception as exc:  # noqa: BLE001
        return {"error": f"Конфіг OpenClaw недоступний ({type(exc).__name__})"}

    tools = config.setdefault("tools", {})
    allow = tools.get("alsoAllow")
    if not isinstance(allow, list):
        allow = []
    allow = [str(name) for name in allow]

    if enabled and qualified not in allow:
        allow.append(qualified)
    elif not enabled and qualified in allow:
        allow = [name for name in allow if name != qualified]
    else:
        return {"ok": True, "enabled": enabled, "reloaded": False, "changed": False}

    tools["alsoAllow"] = allow
    try:
        _write_config(config)
    except Exception as exc:  # noqa: BLE001
        return {"error": f"Не вдалося записати конфіг ({type(exc).__name__})"}

    return {"ok": True, "enabled": enabled, "changed": True, "reloaded": reload_gateway()}
