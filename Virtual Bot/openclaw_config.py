"""
One place that knows where OpenClaw keeps its config and how to read it.

OpenClaw owns the settings the panel edits: models, the gateway token, MCP
servers, skills. The bot used to keep its own copies (config.yaml, .env) and
they drifted apart silently. Now the bot reads them from here and writes them
back through the `openclaw` CLI, so there is exactly one source of truth.

`OPENCLAW_CONFIG_PATH` is the same variable the OpenClaw CLI honours. Setting
it redirects both this reader and every `openclaw` subprocess we spawn, which
is what lets tests run against a throwaway file instead of the owner's config.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

_MISSING = object()


def config_path() -> Path:
    configured = os.environ.get("OPENCLAW_CONFIG_PATH", "").strip()
    if configured:
        return Path(configured).expanduser()
    return Path.home() / ".openclaw" / "openclaw.json"


def load(path: Path | None = None) -> dict[str, Any]:
    """The whole config, or {} when it is missing or unreadable."""
    try:
        data = json.loads((path or config_path()).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def lookup(data: dict[str, Any], dotted: str, default: Any = None) -> Any:
    node: Any = data
    for part in dotted.split("."):
        if not isinstance(node, dict) or part not in node:
            return default
        node = node[part]
    return node


def get(dotted: str, default: Any = None) -> Any:
    return lookup(load(), dotted, default)


def gateway_token() -> str | None:
    """The gateway's own auth token. A secret: never log it."""
    auth = get("gateway.auth", {})
    if not isinstance(auth, dict) or auth.get("mode", "token") != "token":
        return None
    token = str(auth.get("token") or "").strip()
    return token or None


def env_var(name: str) -> str | None:
    """A value from OpenClaw's `env.vars`, where it keeps provider keys."""
    value = get(f"env.vars.{name}")
    text = str(value).strip() if isinstance(value, (str, int)) else ""
    return text or None


def image_model() -> str:
    value = get("agents.defaults.imageModel.primary", "")
    if isinstance(value, dict):
        value = value.get("primary", "")
    return str(value or "").strip()
