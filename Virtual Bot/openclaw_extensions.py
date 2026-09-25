"""
MCP servers and skills as OpenClaw sees them, and the few edits the panel makes.

There is no second list here. Installed MCP servers are `mcp.servers` in
openclaw.json, and skills are whatever `openclaw skills list` reports. Every
change goes through the `openclaw` CLI (`mcp add/unset/configure`, `config
set skills.entries.*`), so OpenClaw validates it and keeps its own backups.

The bot's own bridges (tools, workspace, emotions) are MCP servers too. They
are shown, but cannot be removed or switched off from here: without them the
crab loses its face and its hands, and the Tools tab already manages their
individual tools.
"""

from __future__ import annotations

import json
import re
from typing import Any

import app_config as cfg
import openclaw_config
from openclaw_store import OpenClawStoreError, _agent_args, _json_from_output, _run

_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$")
_SKILL_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
_ENV_KEY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")
_HEADER_RE = re.compile(r"^[A-Za-z0-9-]{1,64}$")
_MAX_OUTPUT = 3000
# `mcp add` connects to the server before saving it. A first `npx` run has to
# download the package, which easily takes a minute on a slow line.
_ADD_TIMEOUT_S = 180


def _is_builtin(server: dict[str, Any]) -> bool:
    """A bridge shipped with this bot: it launches a script from our folder."""
    base = str(cfg.BASE_DIR)
    parts = [str(server.get("command") or ""), *map(str, server.get("args") or [])]
    return any(part.startswith(base) for part in parts)


def _server_view(name: str, server: dict[str, Any]) -> dict[str, Any]:
    url = str(server.get("url") or "")
    env = server.get("env") if isinstance(server.get("env"), dict) else {}
    headers = server.get("headers") if isinstance(server.get("headers"), dict) else {}
    args = [str(arg) for arg in server.get("args") or []]
    return {
        "name": name,
        "transport": "http" if url else "stdio",
        # Command and URL are not secret; env and header VALUES are, so only
        # their names leave this process.
        "launch": url or " ".join([str(server.get("command") or ""), *args]).strip(),
        "enabled": server.get("enabled", True) is not False,
        "env_keys": sorted(env),
        "header_keys": sorted(headers),
        "builtin": _is_builtin(server),
    }


def mcp_servers() -> list[dict[str, Any]]:
    servers = openclaw_config.get("mcp.servers", {})
    if not isinstance(servers, dict):
        return []
    views = [_server_view(name, server) for name, server in servers.items() if isinstance(server, dict)]
    # Bridges last: they are always there and rarely what the owner came for.
    return sorted(views, key=lambda item: (item["builtin"], item["name"].casefold()))


def _missing(item: dict[str, Any]) -> list[str]:
    missing = item.get("missing")
    if not isinstance(missing, dict):
        return []
    out: list[str] = []
    for kind, values in missing.items():
        if isinstance(values, list):
            out += [f"{kind}:{value}" for value in values if value]
    return out


def skills() -> list[dict[str, Any]]:
    payload = _json_from_output(_run(["skills", "list", "--json", *_agent_args()], timeout=30))
    items = payload.get("skills", []) if isinstance(payload, dict) else payload
    result = []
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict) or not item.get("name"):
            continue
        result.append({
            "name": str(item["name"]),
            "description": str(item.get("description") or ""),
            "emoji": str(item.get("emoji") or ""),
            "source": str(item.get("source") or ""),
            "bundled": bool(item.get("bundled")),
            "enabled": not item.get("disabled", False),
            "eligible": bool(item.get("eligible")),
            "missing": _missing(item),
            "homepage": str(item.get("homepage") or ""),
        })
    return sorted(result, key=lambda item: (not item["enabled"], item["name"].casefold()))


def installed() -> dict[str, Any]:
    errors: dict[str, str] = {}
    skill_items: list[dict[str, Any]] = []
    try:
        skill_items = skills()
    except OpenClawStoreError as exc:
        errors["skills"] = str(exc)
    return {
        "available": openclaw_config.config_path().exists(),
        "mcp": mcp_servers(),
        "skills": skill_items,
        "errors": errors,
    }


def _check_name(name: str) -> str:
    value = name.strip()
    if not _NAME_RE.fullmatch(value):
        raise OpenClawStoreError("Invalid MCP server name.", code="invalid_name")
    return value


def _existing(name: str) -> dict[str, Any] | None:
    servers = openclaw_config.get("mcp.servers", {})
    server = servers.get(name) if isinstance(servers, dict) else None
    return server if isinstance(server, dict) else None


def _editable(name: str) -> dict[str, Any]:
    server = _existing(_check_name(name))
    if server is None:
        raise OpenClawStoreError("No such MCP server.", code="not_found")
    if _is_builtin(server):
        raise OpenClawStoreError("The bot's own bridges are managed on the Tools tab.", code="builtin")
    return server


def _reload() -> None:
    """New config applies on the next turn; the gateway itself is not restarted."""
    try:
        _run(["mcp", "reload"], timeout=20)
    except OpenClawStoreError:
        pass  # the server is saved; a stale runtime only delays it one turn


def add_mcp(
    name: str,
    *,
    command: str = "",
    args: list[str] | None = None,
    env: dict[str, str] | None = None,
    url: str = "",
    http_transport: str = "streamable-http",
    headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Add one server with `openclaw mcp add`, which probes it before saving."""
    safe = _check_name(name)
    if _existing(safe) is not None:
        raise OpenClawStoreError(f"An MCP server named {safe} already exists.", code="exists")
    cli = ["mcp", "add", safe]
    if url:
        if not re.match(r"^https?://", url) or len(url) > 2000:
            raise OpenClawStoreError("The URL must start with http:// or https://.", code="invalid_url")
        if http_transport not in {"streamable-http", "sse"}:
            raise OpenClawStoreError("Unknown HTTP transport.", code="invalid_transport")
        cli += ["--url", url, "--transport", http_transport]
        for key, value in (headers or {}).items():
            if not _HEADER_RE.fullmatch(key):
                raise OpenClawStoreError(f"Invalid header name: {key}", code="invalid_header")
            cli += ["--header", f"{key}={value}"]
    else:
        if not command.strip() or len(command) > 400:
            raise OpenClawStoreError("A command is required.", code="invalid_command")
        cli += ["--command", command.strip()]
        for arg in args or []:
            # `--arg=-y` keeps a dash-leading value from reading as a flag.
            cli.append(f"--arg={arg}")
    for key, value in (env or {}).items():
        if not _ENV_KEY_RE.fullmatch(key):
            raise OpenClawStoreError(f"Invalid variable name: {key}", code="invalid_env")
        cli += ["--env", f"{key}={value}"]
    try:
        output = _run(cli, timeout=_ADD_TIMEOUT_S)
    except OpenClawStoreError as exc:
        # A failed probe may echo the command line back, keys included.
        raise OpenClawStoreError(_redact(str(exc), env, headers), code=exc.code) from None
    _reload()
    return {"ok": True, "name": safe, "output": _redact(output, env, headers)}


def _redact(output: str, *secrets: dict[str, str] | None) -> str:
    text = output[-_MAX_OUTPUT:]
    for mapping in secrets:
        for value in (mapping or {}).values():
            if value and len(value) >= 4:
                text = text.replace(value, "••••")
    return text


def remove_mcp(name: str) -> dict[str, Any]:
    _editable(name)
    _run(["mcp", "unset", name.strip()], timeout=30)
    _reload()
    return {"ok": True, "name": name.strip()}


def set_mcp_enabled(name: str, enabled: bool) -> dict[str, Any]:
    _editable(name)
    _run(["mcp", "configure", name.strip(), "--enable" if enabled else "--disable"], timeout=30)
    _reload()
    return {"ok": True, "name": name.strip(), "enabled": enabled}


def set_skill_enabled(name: str, enabled: bool) -> dict[str, Any]:
    value = name.strip()
    # The name becomes part of a config path, so a dot would address a
    # different key entirely.
    if not _SKILL_RE.fullmatch(value):
        raise OpenClawStoreError("Invalid skill name.", code="invalid_name")
    _run(
        ["config", "set", f"skills.entries.{value}.enabled", json.dumps(enabled), "--strict-json"],
        timeout=30,
    )
    return {"ok": True, "name": value, "enabled": enabled}


_SKILL_REF_RE = re.compile(
    r"^(@[A-Za-z0-9._-]{1,64}/[A-Za-z0-9._-]{1,96}"
    r"|skills-sh:[A-Za-z0-9._-]{1,64}/[A-Za-z0-9._-]{1,96}/[A-Za-z0-9._-]{1,96})$"
)


def install_skill_ref(ref: str) -> dict[str, Any]:
    """Install a ClawHub (`@owner/slug`) or skills.sh (`skills-sh:o/r/s`) skill."""
    value = ref.strip()
    if not _SKILL_REF_RE.fullmatch(value) or ".." in value:
        raise OpenClawStoreError("Invalid skill reference.", code="invalid_slug")
    output = _run(["skills", "install", value, *_agent_args()], timeout=180)
    return {"ok": True, "ref": value, "output": output[-_MAX_OUTPUT:]}

