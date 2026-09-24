"""
Curated OpenClaw settings for the panel.

The gateway schema is thousands of fields, including tokens and break-glass
flags. This module is the allowlist: the panel can read and write only these
paths, and only through `openclaw config set`, which validates before it
writes. A path that is not in the catalog is refused before the CLI runs.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from pathlib import Path

import openclaw_models

log = logging.getLogger("virtual_bot.openclaw_settings")

CONFIG_PATH = Path.home() / ".openclaw" / "openclaw.json"

_MISSING = object()


@dataclass(frozen=True)
class Spec:
    path: str
    group: str
    kind: str  # bool | int | enum | string
    options: tuple[str, ...] = ()
    default: object = None
    minimum: int | None = None
    maximum: int | None = None
    max_length: int = 80
    # Which settings tab this row belongs on. The panel has no OpenClaw tab:
    # a gateway field sits in the same category as the local fields it belongs with.
    section: str = "brain"


# Order is the order the panel renders. Defaults are the ones the schema
# states outright; an unknown default stays None and the control shows the
# stored value only.
CATALOG: tuple[Spec, ...] = (
    Spec("agents.defaults.thinkingDefault", "thinking", "enum",
         ("off", "minimal", "low", "medium", "high", "xhigh", "adaptive", "max", "ultra"),
         section="style"),
    Spec("agents.defaults.timeoutSeconds", "thinking", "int", minimum=0, maximum=3600, section="style"),
    Spec("session.dmScope", "session", "enum",
         ("main", "per-peer", "per-channel-peer", "per-account-channel-peer"),
         default="main", section="style"),
    Spec("session.reset.idleMinutes", "session", "int", minimum=0, maximum=10080, section="style"),
    Spec("tools.sessions.visibility", "session", "enum",
         ("self", "tree", "agent", "all"), default="all", section="style"),
    Spec("messages.inbound.debounceMs", "messages", "int", default=0, minimum=0, maximum=10000, section="style"),
    Spec("messages.ackReactionScope", "messages", "enum",
         ("group-mentions", "group-all", "direct", "all", "off", "none"), section="style"),
    Spec("messages.groupChat.historyLimit", "messages", "int", minimum=0, maximum=200, section="style"),
    Spec("commands.text", "messages", "bool", default=True, section="style"),
    Spec("tts.enabled", "gateway", "bool", default=False, section="voice"),
    Spec("tts.auto", "gateway", "enum", ("off", "always", "inbound", "tagged"), default="off", section="voice"),
    Spec("agents.defaults.userTimezone", "agent", "string", max_length=64, section="brain"),
    Spec("agents.defaults.maxConcurrent", "agent", "int", minimum=1, maximum=32, section="brain"),
    Spec("agents.defaults.imageQuality", "agent", "enum",
         ("auto", "efficient", "balanced", "high"), default="auto", section="brain"),
    Spec("agents.defaults.compaction.enabled", "context", "bool", default=True, section="brain"),
    Spec("agents.defaults.compaction.notifyUser", "context", "bool", default=False, section="brain"),
    Spec("agents.defaults.compaction.recentTurnsPreserve", "context", "int",
         default=3, minimum=0, maximum=20, section="brain"),
    Spec("agents.defaults.compaction.memoryFlush.enabled", "context", "bool", default=True, section="brain"),
    Spec("agents.defaults.startupContext.enabled", "context", "bool", default=True, section="brain"),
    Spec("memory.search.enabled", "memory", "bool", default=True, section="brain"),
    Spec("memory.search.query.maxResults", "memory", "int", default=6, minimum=1, maximum=20, section="brain"),
    Spec("tools.web.search.enabled", "web", "bool", default=True, section="tools"),
    Spec("tools.web.search.maxResults", "web", "int", default=5, minimum=1, maximum=10, section="tools"),
    Spec("tools.web.fetch.enabled", "web", "bool", default=True, section="tools"),
    Spec("tools.links.enabled", "web", "bool", default=True, section="tools"),
    Spec("tools.media.image.enabled", "media", "bool", default=True, section="tools"),
    Spec("tools.media.audio.enabled", "media", "bool", default=True, section="tools"),
    Spec("tools.media.video.enabled", "media", "bool", default=True, section="tools"),
    Spec("tools.media.audio.echoTranscript", "media", "bool", default=False, section="tools"),
    Spec("tools.exec.mode", "exec", "enum",
         ("deny", "allowlist", "ask", "auto", "full"), section="tools"),
    Spec("tools.exec.security", "exec", "enum", ("deny", "allowlist", "full"), section="tools"),
    Spec("tools.exec.ask", "exec", "enum", ("off", "on-miss", "always"), section="tools"),
    Spec("tools.fs.workspaceOnly", "exec", "bool", default=False, section="tools"),
    Spec("tools.elevated.enabled", "exec", "bool", default=False, section="tools"),
    Spec("browser.enabled", "browser", "bool", default=True, section="tools"),
    Spec("browser.headless", "browser", "bool", default=True, section="tools"),
    Spec("commands.restart", "commands", "bool", default=True, section="tools"),
    Spec("commands.config", "commands", "bool", default=False, section="tools"),
)

_BY_PATH = {spec.path: spec for spec in CATALOG}


def spec_for(path: str) -> Spec | None:
    return _BY_PATH.get(path)


def _dig(config: dict, path: str) -> object:
    current: object = config
    for part in path.split("."):
        if not isinstance(current, dict) or part not in current:
            return _MISSING
        current = current[part]
    return current


def _read_config() -> dict | None:
    try:
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def _fits(spec: Spec, value: object) -> bool:
    if spec.kind == "bool":
        return isinstance(value, bool)
    if spec.kind == "int":
        return isinstance(value, int) and not isinstance(value, bool)
    if spec.kind == "enum":
        return isinstance(value, str) and value in spec.options
    return isinstance(value, str)


def snapshot() -> dict:
    """Allowlisted fields only. The rest of openclaw.json never leaves this process."""
    config = _read_config()
    if config is None:
        return {"available": False, "fields": []}
    fields = []
    for spec in CATALOG:
        raw = _dig(config, spec.path)
        unset = raw is _MISSING or not _fits(spec, raw)
        value = spec.default if unset else raw
        fields.append({
            "path": spec.path,
            "section": spec.section,
            "group": spec.group,
            "kind": spec.kind,
            "options": list(spec.options),
            "value": value,
            "unset": unset,
        })
    return {"available": True, "fields": fields}


def coerce(spec: Spec, value: object) -> object | None:
    """
    Turn a panel value into the JSON value OpenClaw should store.

    None and "" unset the path, so the gateway's own default comes back.
    Anything else that does not match the spec is refused.
    """
    if value is None or value == "":
        return None
    if spec.kind == "bool":
        if not isinstance(value, bool):
            raise ValueError(spec.path)
        return value
    if spec.kind == "int":
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(spec.path)
        number = int(value)
        if spec.minimum is not None and number < spec.minimum:
            raise ValueError(spec.path)
        if spec.maximum is not None and number > spec.maximum:
            raise ValueError(spec.path)
        return number
    if spec.kind == "enum":
        text = str(value).strip()
        if text not in spec.options:
            raise ValueError(spec.path)
        return text
    text = str(value).strip()
    if not text or len(text) > spec.max_length:
        raise ValueError(spec.path)
    return text


async def apply(path: str, value: object) -> bool:
    """Write one allowlisted path. Returns False when the CLI rejects it."""
    spec = spec_for(path)
    if spec is None:
        raise ValueError(path)
    stored = coerce(spec, value)
    if stored is None:
        args = ("config", "unset", path)
    else:
        args = ("config", "set", path, json.dumps(stored), "--strict-json")
    code, _out, err = await openclaw_models._run_cli(*args)
    if code != 0:
        log.warning("openclaw config %s %s: code %d (%s)", args[1], path, code, err.strip()[:160])
    return code == 0
