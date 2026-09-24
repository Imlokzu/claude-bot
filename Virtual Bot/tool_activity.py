"""Bounded, redacted tool activity belonging to one chat response."""

from __future__ import annotations

import json
import re
import time
import uuid

MAX_STEPS = 200
_SECRET_KEY = re.compile(r"token|secret|password|authorization|cookie|api.?key|credential|private.?key", re.I)
_BEARER = re.compile(r"(?i)(bearer\s+)[\w.~/+\-=]+")
_SECRET_TEXT = re.compile(
    r"(?i)((?:[\w-]*(?:api[_-]?key|token|password|secret|authorization|cookie)[\w-]*)"
    r"[\"']?\s*[=:]\s*[\"']?)[^\s\"'&,;]+"
)
_URL_PASSWORD = re.compile(r"(https?://[^\s/:]+:)[^\s/@]+@", re.I)


def redact(value, depth: int = 0):
    """Keep useful diagnostics, never credentials or unbounded tool payloads."""
    if depth > 5:
        return "…"
    if isinstance(value, dict):
        return {
            str(key)[:100]: "[redacted]" if _SECRET_KEY.search(str(key)) else redact(item, depth + 1)
            for key, item in list(value.items())[:40]
        }
    if isinstance(value, list):
        return [redact(item, depth + 1) for item in value[:40]]
    if isinstance(value, str):
        clean = _BEARER.sub(r"\1[redacted]", value[:8000])
        clean = _SECRET_TEXT.sub(r"\1[redacted]", clean)
        return _URL_PASSWORD.sub(r"\1[redacted]@", clean)
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return redact(str(value), depth + 1)


def safe_payload(value):
    clean = redact(value)
    encoded = json.dumps(clean, ensure_ascii=False)
    return clean if len(encoded) <= 8000 else encoded[:8000] + "…"


def detail_for(args: dict) -> str:
    if not isinstance(args, dict):
        return ""
    clean = redact(args)
    for key in ("query", "city", "path", "file_path", "base", "url", "name", "title",
                "text", "message", "question", "command", "video_id", "id"):
        value = clean.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()[:240]
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return str(value)
    return ", ".join(f"{key}={value}" for key, value in clean.items()
                     if not _SECRET_KEY.search(key) and isinstance(value, (str, int, float))
                     and not isinstance(value, bool) and str(value).strip())[:240]


def result_failed(result) -> bool:
    if not isinstance(result, dict):
        return False
    if (result.get("error") or result.get("isError") or result.get("is_error")
            or result.get("success") is False or result.get("ok") is False):
        return True
    # MCP transports can succeed while their structured application result fails.
    nested = result.get("result")
    if isinstance(nested, dict) and (nested.get("error") or nested.get("isError")):
        return True
    for block in result.get("content", []) if isinstance(result.get("content"), list) else []:
        if not isinstance(block, dict) or block.get("type") != "text":
            continue
        try:
            payload = json.loads(str(block.get("text", ""))[:8000])
        except ValueError:
            continue
        if isinstance(payload, dict) and (payload.get("error") or payload.get("isError")
                or isinstance(payload.get("result"), dict) and payload["result"].get("error")):
            return True
    return False


class ActivityLog:
    """Normalize both native OpenClaw and legacy local tool events by call ID."""

    def __init__(self):
        self.steps: list[dict] = []

    def record(self, event: dict) -> dict:
        event = dict(event)
        name = str(event.get("tool") or "tool")[:120]
        call_id = str(event.get("call_id") or "")[:200]
        kind = event.get("type")
        step = next((item for item in self.steps if call_id and item["id"] == call_id), None)
        if not step and not call_id and kind != "tool_start":
            step = next((item for item in self.steps
                         if item["label"] == name and item["status"] == "active"), None)
        now = int(time.time() * 1000)
        if step is None:
            step = {"id": call_id or uuid.uuid4().hex, "label": name, "detail": "",
                    "status": "active", "startedAt": now, "source": event.get("source", "local")}
            self.steps.append(step)
            # Retain the latest bounded history, not a growing result buffer.
            del self.steps[:-MAX_STEPS]
        if "input" in event:
            step["input"] = safe_payload(event["input"])
        detail = event.get("detail") or detail_for(event.get("input", {}))
        if detail:
            step["detail"] = redact(str(detail))[:240]
        if "result" in event:
            step["result"] = safe_payload(event["result"])
        if kind in ("tool_done", "tool_result", "tool_error"):
            step["status"] = "failed" if (kind == "tool_error" or event.get("is_error")
                                             or result_failed(event.get("result"))) else "done"
            step["endedAt"] = now
        # A duplicate start/progress must never reopen a completed call.
        return {"type": kind, "tool": name, "call_id": step["id"], "step": dict(step),
                "detail": step["detail"], "status": step["status"],
                **({"input": step["input"]} if "input" in step else {}),
                **({"result": step["result"]} if "result" in step else {})}

    def finish(self, status: str = "interrupted") -> list[dict]:
        for step in self.steps:
            if step["status"] == "active":
                step["status"] = status
                step["endedAt"] = int(time.time() * 1000)
        return [dict(step) for step in self.steps]
