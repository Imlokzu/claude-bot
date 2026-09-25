"""
Public catalogs of MCP servers and skills, normalized into one shape.

Four sources, all keyless:

- `mcp-registry`: the official MCP Registry (registry.modelcontextprotocol.io),
  which describes how to launch each server (npm, PyPI, OCI or a remote URL).
- `smithery`: Smithery's registry, ranked by use. Only its hosted servers are
  installable here; they are reached over HTTP with a Smithery API key.
- `clawhub`: OpenClaw's own skill hub, searched through `openclaw skills search`.
- `skills-sh`: the skills.sh directory, installed by OpenClaw as
  `skills-sh:owner/repo/skill`.

A search result only describes. The install endpoint never runs a command the
browser sent: it asks this module to rebuild the plan from the source, so a
tampered request cannot turn "install X" into "run anything".
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import quote

import httpx

from openclaw_store import OpenClawStoreError, _json_from_output, _run

REGISTRY_URL = "https://registry.modelcontextprotocol.io/v0"
SMITHERY_URL = "https://registry.smithery.ai"
SMITHERY_SERVER_URL = "https://server.smithery.ai"
SKILLS_SH_URL = "https://skills.sh/api"

SOURCES: dict[str, dict[str, str]] = {
    "mcp-registry": {"kind": "mcp", "homepage": "https://registry.modelcontextprotocol.io"},
    "smithery": {"kind": "mcp", "homepage": "https://smithery.ai"},
    "clawhub": {"kind": "skill", "homepage": "https://clawhub.ai"},
    "skills-sh": {"kind": "skill", "homepage": "https://skills.sh"},
}

_TIMEOUT = httpx.Timeout(15.0, connect=8.0)
_PLACEHOLDER_RE = re.compile(r"\{[^{}]+\}")
_NAME_CLEAN_RE = re.compile(r"[^a-z0-9_-]+")


class RegistryError(RuntimeError):
    def __init__(self, message: str, *, code: str = "registry_failed") -> None:
        super().__init__(message)
        self.code = code


def _get(url: str, params: dict[str, Any] | None = None) -> Any:
    try:
        with httpx.Client(timeout=_TIMEOUT, follow_redirects=True) as client:
            response = client.get(url, params=params, headers={"Accept": "application/json"})
    except httpx.HTTPError as exc:
        raise RegistryError(f"{type(exc).__name__}", code="unreachable") from exc
    if response.status_code == 404:
        raise RegistryError("Not found in the catalog.", code="not_found")
    if response.status_code >= 400:
        raise RegistryError(f"HTTP {response.status_code}", code="http_error")
    try:
        return response.json()
    except ValueError as exc:
        raise RegistryError("The catalog returned something other than JSON.", code="invalid_json") from exc


def suggest_name(raw: str) -> str:
    """`io.github.acme/weather-mcp` -> `weather-mcp`, safe for `mcp add`."""
    tail = raw.strip().rsplit("/", 1)[-1].lstrip("@")
    name = _NAME_CLEAN_RE.sub("-", tail.lower()).strip("-_")
    return (name or "server")[:48]


def fill_template(template: str, value: str) -> str:
    """
    `Bearer {api_key}` + `sk-1` -> `Bearer sk-1`. People paste the key, not
    the whole header; a value that already has the fixed part is kept as is.
    """
    value = value.strip()
    holes = _PLACEHOLDER_RE.findall(template)
    if len(holes) != 1:
        return value
    prefix, suffix = template.split(holes[0], 1)
    if value.startswith(prefix) and value.endswith(suffix):
        return value
    return f"{prefix}{value}{suffix}"


# ------------------------------------------------------------------ search


def _registry_search(query: str, limit: int) -> list[dict[str, Any]]:
    params: dict[str, Any] = {"limit": limit, "version": "latest"}
    if query:
        params["search"] = query
    payload = _get(f"{REGISTRY_URL}/servers", params)
    items = []
    for entry in payload.get("servers", []) if isinstance(payload, dict) else []:
        server = entry.get("server") if isinstance(entry, dict) else None
        if not isinstance(server, dict) or not server.get("name"):
            continue
        plan = _registry_plan(server)
        items.append({
            "source": "mcp-registry",
            "kind": "mcp",
            "id": server["name"],
            "name": server.get("title") or server["name"].rsplit("/", 1)[-1],
            "description": server.get("description") or "",
            "homepage": (server.get("repository") or {}).get("url") or server.get("websiteUrl") or "",
            "version": server.get("version") or "",
            "installable": plan is not None,
            "via": plan["via"] if plan else "",
        })
    return items


def _smithery_search(query: str, limit: int) -> list[dict[str, Any]]:
    params: dict[str, Any] = {"pageSize": limit}
    if query:
        params["q"] = query
    payload = _get(f"{SMITHERY_URL}/servers", params)
    items = []
    for server in payload.get("servers", []) if isinstance(payload, dict) else []:
        if not isinstance(server, dict) or not server.get("qualifiedName"):
            continue
        name = server["qualifiedName"]
        remote = bool(server.get("remote"))
        items.append({
            "source": "smithery",
            "kind": "mcp",
            "id": name,
            "name": server.get("displayName") or name,
            "description": server.get("description") or "",
            "homepage": f"https://smithery.ai/server/{name}",
            "popularity": server.get("useCount") or 0,
            "verified": bool(server.get("verified")),
            "installable": remote,
            "via": "http" if remote else "",
        })
    return items


def _clawhub_search(query: str, limit: int) -> list[dict[str, Any]]:
    try:
        output = _run(["skills", "search", query, "--json", "--limit", str(limit)], timeout=45)
        payload = _json_from_output(output)
    except OpenClawStoreError as exc:
        raise RegistryError(str(exc), code=exc.code) from exc
    items = []
    for item in payload.get("results", []) if isinstance(payload, dict) else []:
        ref = item.get("installRef") if isinstance(item, dict) else None
        if not ref:
            continue
        items.append({
            "source": "clawhub",
            "kind": "skill",
            "id": ref,
            "name": item.get("displayName") or item.get("slug") or ref,
            "description": item.get("summary") or "",
            "homepage": f"https://clawhub.ai{item.get('canonicalUrl') or ''}",
            "popularity": item.get("downloads") or 0,
            "verified": bool(item.get("official")),
            "installable": True,
            "via": "clawhub",
        })
    return items


def _skills_sh_search(query: str, limit: int) -> list[dict[str, Any]]:
    # skills.sh refuses queries shorter than two characters, and has no
    # public "top" listing. An empty result is honest; the panel explains it.
    if len(query) < 2:
        return []
    payload = _get(f"{SKILLS_SH_URL}/search", {"q": query, "limit": limit})
    items = []
    for item in payload.get("skills", []) if isinstance(payload, dict) else []:
        skill_id = item.get("id") if isinstance(item, dict) else None
        if not skill_id or skill_id.count("/") != 2:
            continue
        items.append({
            "source": "skills-sh",
            "kind": "skill",
            "id": skill_id,
            "name": item.get("name") or skill_id.rsplit("/", 1)[-1],
            "description": item.get("source") or "",
            "homepage": f"https://skills.sh/{skill_id}",
            "popularity": item.get("installs") or 0,
            "installable": True,
            "via": "skills-sh",
        })
    return items


_SEARCH = {
    "mcp-registry": _registry_search,
    "smithery": _smithery_search,
    "clawhub": _clawhub_search,
    "skills-sh": _skills_sh_search,
}


def search(source: str, query: str = "", limit: int = 20) -> dict[str, Any]:
    if source not in _SEARCH:
        raise RegistryError("Unknown source.", code="unknown_source")
    items = _SEARCH[source](query.strip(), max(1, min(limit, 50)))
    return {"source": source, "kind": SOURCES[source]["kind"], "query": query.strip(), "items": items}


# ------------------------------------------------------------------ install plans


def _field(item: dict[str, Any], *, default_secret: bool = False) -> dict[str, Any]:
    return {
        "name": str(item.get("name") or ""),
        "description": str(item.get("description") or ""),
        "required": bool(item.get("isRequired")),
        "secret": bool(item.get("isSecret", default_secret)),
        "default": str(item.get("default") or ""),
        # For headers: the shape the value should take, e.g. "Bearer {key}".
        "template": str(item.get("value") or ""),
    }


def _static_args(arguments: Any) -> list[str]:
    """Registry arguments with a fixed value. Templated ones are left out."""
    out: list[str] = []
    for arg in arguments if isinstance(arguments, list) else []:
        if not isinstance(arg, dict):
            continue
        value = str(arg.get("value") or arg.get("default") or "")
        if not value or _PLACEHOLDER_RE.search(value):
            continue
        if arg.get("type") == "named" and arg.get("name"):
            out.append(f"{arg['name']}={value}")
        else:
            out.append(value)
    return out


def _package_plan(package: dict[str, Any]) -> dict[str, Any] | None:
    if (package.get("transport") or {}).get("type", "stdio") != "stdio":
        return None
    kind = package.get("registryType")
    ident = str(package.get("identifier") or "")
    version = str(package.get("version") or "")
    if not ident:
        return None
    env = [_field(item) for item in package.get("environmentVariables") or [] if isinstance(item, dict)]
    runtime = _static_args(package.get("runtimeArguments"))
    extra = _static_args(package.get("packageArguments"))
    if kind == "npm":
        spec = f"{ident}@{version}" if version else ident
        args = (runtime or ["-y"]) + [spec] + extra
        return {"via": "npm", "transport": "stdio", "command": "npx", "args": args, "env": env}
    if kind == "pypi":
        spec = f"{ident}=={version}" if version else ident
        return {"via": "pypi", "transport": "stdio", "command": "uvx", "args": runtime + [spec] + extra, "env": env}
    if kind == "oci":
        # `-e NAME` forwards the value OpenClaw puts in the server's env.
        forwarded = [flag for item in env for flag in ("-e", item["name"])]
        args = ["run", "-i", "--rm", *forwarded, ident, *extra]
        return {"via": "docker", "transport": "stdio", "command": "docker", "args": args, "env": env}
    return None


def _remote_plan(remote: dict[str, Any]) -> dict[str, Any] | None:
    url = str(remote.get("url") or "")
    kind = remote.get("type")
    if not url.startswith("https://") or _PLACEHOLDER_RE.search(url):
        return None
    if kind not in {"streamable-http", "sse"}:
        return None
    headers = [_field(item, default_secret=True) for item in remote.get("headers") or [] if isinstance(item, dict)]
    return {"via": "http", "transport": "http", "url": url, "http_transport": kind, "headers": headers}


def _registry_plan(server: dict[str, Any]) -> dict[str, Any] | None:
    """
    Pick the launch method least likely to need setup: a remote with no
    required headers, then npm and PyPI packages, then remotes that need a
    key, and Docker last because it needs a running daemon.
    """
    remotes = [plan for plan in map(_remote_plan, server.get("remotes") or []) if plan]
    packages = [plan for plan in map(_package_plan, server.get("packages") or []) if plan]
    open_remotes = [plan for plan in remotes if not any(h["required"] for h in plan["headers"])]
    ranked = (
        open_remotes
        + [plan for plan in packages if plan["via"] in {"npm", "pypi"}]
        + [plan for plan in remotes if plan not in open_remotes]
        + [plan for plan in packages if plan["via"] == "docker"]
    )
    return ranked[0] if ranked else None


def plan(source: str, item_id: str) -> dict[str, Any]:
    """What installing this item will do, and which values the owner must fill in."""
    item_id = item_id.strip()
    if not item_id or len(item_id) > 200:
        raise RegistryError("Invalid id.", code="invalid_id")
    if source == "mcp-registry":
        payload = _get(f"{REGISTRY_URL}/servers/{quote(item_id, safe='')}/versions/latest")
        server = payload.get("server") if isinstance(payload, dict) else None
        found = _registry_plan(server) if isinstance(server, dict) else None
        if found is None:
            raise RegistryError("This server has no launch method OpenClaw can use.", code="not_installable")
        return {"source": source, "id": item_id, "kind": "mcp", "name": suggest_name(item_id), **found}
    if source == "smithery":
        if not re.fullmatch(r"@?[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)?", item_id):
            raise RegistryError("Invalid id.", code="invalid_id")
        server = _get(f"{SMITHERY_URL}/servers/{quote(item_id, safe='@/')}")
        if not isinstance(server, dict) or not server.get("remote"):
            raise RegistryError("Only servers Smithery hosts can be added here.", code="not_installable")
        return {
            "source": source, "id": item_id, "kind": "mcp", "name": suggest_name(item_id),
            "via": "http", "transport": "http", "http_transport": "streamable-http",
            "url": f"{SMITHERY_SERVER_URL}/{item_id}/mcp",
            "headers": [{
                "name": "Authorization",
                "description": "Smithery API key (smithery.ai/account/api-keys)",
                "required": True, "secret": True, "default": "",
                "template": "Bearer {smithery_api_key}",
            }],
        }
    if source == "clawhub":
        return {"source": source, "id": item_id, "kind": "skill", "ref": item_id}
    if source == "skills-sh":
        return {"source": source, "id": item_id, "kind": "skill", "ref": f"skills-sh:{item_id}"}
    raise RegistryError("Unknown source.", code="unknown_source")
