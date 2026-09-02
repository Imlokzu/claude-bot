"""Каталог і встановлення скілів через офіційний CLI OpenClaw."""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from typing import Any

import app_config as cfg
import setup_suggestions


class OpenClawStoreError(RuntimeError):
    """Помилка доступу до OpenClaw або його реєстру."""

    def __init__(self, message: str, *, code: str = "command_failed", output: str = "") -> None:
        super().__init__(message)
        self.code = code
        self.output = output


_SKILL_SLUG_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$")
_MAX_OUTPUT = 3000


def _openclaw_command() -> str:
    configured = os.environ.get("OPENCLAW_BIN", "").strip()
    if configured:
        return configured
    return shutil.which("openclaw") or "openclaw"


def _agent_args() -> list[str]:
    agent = str(getattr(cfg, "OPENCLAW_AGENT", "")).strip()
    return ["--agent", agent] if agent else []


def _run(args: list[str], *, timeout: int) -> str:
    command = [_openclaw_command(), *args]
    try:
        proc = subprocess.run(
            command,
            cwd=str(cfg.BASE_DIR),
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except FileNotFoundError as exc:
        raise OpenClawStoreError(
            "Команда openclaw не знайдена у PATH.",
            code="not_found",
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise OpenClawStoreError(
            "OpenClaw не відповів вчасно.",
            code="timeout",
        ) from exc
    except OSError as exc:
        raise OpenClawStoreError(
            f"Не вдалося запустити OpenClaw: {type(exc).__name__}",
            code="launch_failed",
        ) from exc

    output = "\n".join(part for part in (proc.stdout, proc.stderr) if part).strip()
    if proc.returncode != 0:
        raise OpenClawStoreError(
            output[-_MAX_OUTPUT:] or f"OpenClaw завершився з кодом {proc.returncode}.",
            code="command_failed",
            output=output[-_MAX_OUTPUT:],
        )
    return output


def _json_from_output(output: str) -> Any:
    decoder = json.JSONDecoder()
    for index, char in enumerate(output):
        if char not in "[{":
            continue
        try:
            value, _ = decoder.raw_decode(output[index:])
            return value
        except json.JSONDecodeError:
            continue
    raise OpenClawStoreError("OpenClaw повернув неочікувану відповідь.", code="invalid_json")


def _items(payload: Any, keys: tuple[str, ...]) -> list[Any]:
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        return []
    for key in keys:
        value = payload.get(key)
        if isinstance(value, list):
            return value
    return []


def _skill_item(item: Any) -> dict[str, Any] | None:
    if isinstance(item, str):
        name = item.strip()
        if not name:
            return None
        return {"slug": name, "name": name, "description": ""}
    if not isinstance(item, dict):
        return None
    slug = str(item.get("slug") or item.get("name") or item.get("id") or "").strip()
    if not slug:
        return None
    description = str(item.get("description") or item.get("desc") or "").strip()
    result: dict[str, Any] = {
        "kind": "skill",
        "slug": slug,
        "name": str(item.get("name") or slug),
        "description": description,
        "source": str(item.get("source") or "clawhub"),
        "homepage": item.get("homepage") or item.get("url") or "",
        "version": item.get("version") or item.get("latestVersion") or "",
    }
    for key in ("emoji", "downloads", "score", "eligible", "missing", "installed", "bundled"):
        if key in item:
            result[key] = item[key]
    return result


def _skill_list() -> list[dict[str, Any]]:
    payload = _json_from_output(_run(["skills", "list", "--json", *_agent_args()], timeout=20))
    result = []
    for item in _items(payload, ("skills", "results", "items")):
        normalized = _skill_item(item)
        if normalized is None:
            continue
        normalized["installed"] = True
        normalized["bundled"] = bool(item.get("bundled")) if isinstance(item, dict) else False
        result.append(normalized)
    return result


def _skill_search(query: str, limit: int) -> list[dict[str, Any]]:
    payload = _json_from_output(
        _run(["skills", "search", query, "--json", "--limit", str(limit)], timeout=45)
    )
    result = []
    for item in _items(payload, ("skills", "results", "items")):
        normalized = _skill_item(item)
        if normalized is not None:
            result.append(normalized)
    return result[:limit]


def _mcp_status() -> dict[str, Any]:
    payload = _json_from_output(_run(["mcp", "list", "--json"], timeout=20))
    if not isinstance(payload, dict):
        return {}
    return payload


def _matches(item: dict[str, Any], query: str) -> bool:
    if not query:
        return True
    haystack = " ".join(
        str(item.get(key) or "")
        for key in ("id", "name", "description", "category", "note", "slug")
    ).casefold()
    return query.casefold() in haystack


def _mcp_catalog(query: str, installed: dict[str, Any]) -> list[dict[str, Any]]:
    result = []
    for item in setup_suggestions.MCP_SUGGESTIONS:
        if not _matches(item, query):
            continue
        result.append({
            "kind": "mcp",
            "id": item["id"],
            "name": item["name"],
            "description": item["desc"],
            "category": item["category"],
            "needs_key": item["needs_key"],
            "recommended": item.get("recommended", False),
            "env": item.get("env", []),
            "note": item["note"],
            "installed": item["id"] in installed,
        })
    return result


def catalog(*, query: str = "", kind: str = "all", limit: int = 24) -> dict[str, Any]:
    """Повертає локальний MCP-каталог і результати OpenClaw Skills Registry."""
    query = query.strip()
    errors: dict[str, str] = {}
    skills: list[dict[str, Any]] = []
    installed_skills: list[dict[str, Any]] = []
    installed_mcp: dict[str, Any] = {}

    if kind in {"all", "skills"}:
        try:
            installed_skills = _skill_list()
            if query:
                skills = _skill_search(query, limit)
            else:
                skills = installed_skills[:limit]
            installed_names = {item["slug"] for item in installed_skills}
            for item in skills:
                item["installed"] = item.get("installed", False) or item["slug"] in installed_names
        except OpenClawStoreError as exc:
            errors["skills"] = str(exc)

    if kind in {"all", "mcp"}:
        try:
            installed_mcp = _mcp_status()
        except OpenClawStoreError as exc:
            errors["mcp"] = str(exc)

    return {
        "query": query,
        "kind": kind,
        "skills": skills,
        "mcp": _mcp_catalog(query, installed_mcp),
        "installed": {
            "skills": [item["slug"] for item in installed_skills],
            "mcp": sorted(installed_mcp.keys()),
        },
        "errors": errors,
        "openclaw": {"available": shutil.which(_openclaw_command()) is not None or bool(os.environ.get("OPENCLAW_BIN"))},
    }


def _validate_skill_slug(slug: str) -> str:
    value = slug.strip()
    if not _SKILL_SLUG_RE.fullmatch(value) or ".." in value or value.startswith("-"):
        raise OpenClawStoreError("Некоректний slug скіла.", code="invalid_slug")
    return value


def install_skill(slug: str, *, version: str = "", force: bool = False) -> dict[str, Any]:
    """Встановлює скіл тільки через `openclaw skills install`."""
    safe_slug = _validate_skill_slug(slug)
    args = ["skills", "install", safe_slug, *_agent_args()]
    if version.strip():
        if not re.fullmatch(r"^[A-Za-z0-9._+-]{1,64}$", version.strip()):
            raise OpenClawStoreError("Некоректна версія скіла.", code="invalid_version")
        args += ["--version", version.strip()]
    if force:
        args.append("--force")
    output = _run(args, timeout=120)
    return {"ok": True, "kind": "skill", "slug": safe_slug, "output": output[-_MAX_OUTPUT:]}
