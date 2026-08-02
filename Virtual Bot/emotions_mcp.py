#!/usr/bin/env python3
"""
«Клод Бот» — emotions-MCP: крихітний stdio-MCP-сервер (без залежностей), що дає
OpenClaw-агенту інструмент `set_emotion`. Коли агент його викликає, сервер шле
POST на Virtual Bot /api/emotion → SSE → обличчя піксельного краба реагує НАЖИВО
на реальну активність мозку (searching/web/working/writing/…).

Протокол: MCP поверх stdio = JSON-RPC 2.0, повідомлення роздільник — новий рядок
(не LSP-фреймінг). Реалізовано методи: initialize, tools/list, tools/call,
ping; нотифікації (notifications/*) тихо ігноруються.

Реєстрація в OpenClaw:
  openclaw mcp add emotions --command python3 --arg /абс/шлях/emotions_mcp.py \
    --env VBOT_URL=http://127.0.0.1:8100

Секретів немає. Помилка HTTP не валить сервер — інструмент повертає ok:false.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request

VBOT_URL = os.environ.get("VBOT_URL", "http://127.0.0.1:8100").rstrip("/")
PROTOCOL_VERSION = "2024-11-05"

# Дозволені емоції — дублюємо контракт emotions.py/crab.js (щоб MCP був самодостатнім).
ALLOWED = [
    "idle", "listening", "thinking", "speaking", "happy", "sad", "confused",
    "surprised", "love", "sleepy", "searching", "web", "working", "writing",
    "asking", "greeting", "loading", "celebrating", "cool",
]

TOOL = {
    "name": "set_emotion",
    "description": (
        "Показати емоцію/активність на обличчі робота-компаньйона (піксельний краб) "
        "у веб-панелі. Викликай ЩОРАЗУ, коли змінюється твій стан або ти щось робиш: "
        "greeting коли вітаєшся; thinking коли міркуєш; searching коли шукаєш у памʼяті/файлах; "
        "web коли шукаєш в інтернеті; working коли виконуєш задачу; writing коли пишеш у памʼять; "
        "asking коли сам ставиш запитання; happy/celebrating коли радієш; sad коли сумно; "
        "love для ніжності; surprised для здивування. Це оживляє бота — став емоцію рано й часто."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "emotion": {"type": "string", "enum": ALLOWED, "description": "Одна з дозволених емоцій"},
        },
        "required": ["emotion"],
    },
}


def _post_emotion(emotion: str) -> bool:
    """POST /api/emotion на Virtual Bot. True — успіх."""
    data = json.dumps({"emotion": emotion}).encode("utf-8")
    req = urllib.request.Request(
        f"{VBOT_URL}/api/emotion", data=data,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=4) as resp:
            return resp.status == 200
    except Exception:  # noqa: BLE001 — панель могла бути вимкнена; не валимо MCP
        return False


def _send(msg: dict) -> None:
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()


def _result(req_id, result: dict) -> None:
    _send({"jsonrpc": "2.0", "id": req_id, "result": result})


def _error(req_id, code: int, message: str) -> None:
    _send({"jsonrpc": "2.0", "id": req_id, "error": {"code": code, "message": message}})


def _handle(msg: dict) -> None:
    method = msg.get("method")
    req_id = msg.get("id")

    # Нотифікації (без id) — нічого не відповідаємо
    if req_id is None and method and method.startswith("notifications/"):
        return

    if method == "initialize":
        _result(req_id, {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "klod-bot-emotions", "version": "1.0.0"},
        })
    elif method == "ping":
        _result(req_id, {})
    elif method == "tools/list":
        _result(req_id, {"tools": [TOOL]})
    elif method == "tools/call":
        params = msg.get("params") or {}
        name = params.get("name")
        args = params.get("arguments") or {}
        if name != "set_emotion":
            _error(req_id, -32602, f"Невідомий інструмент: {name}")
            return
        emotion = str(args.get("emotion", "")).strip().lower()
        if emotion not in ALLOWED:
            emotion = "idle"
        ok = _post_emotion(emotion)
        text = (f"Емоцію «{emotion}» показано на обличчі." if ok
                else f"Емоцію «{emotion}» прийнято (панель офлайн).")
        _result(req_id, {"content": [{"type": "text", "text": text}], "isError": False})
    elif req_id is not None:
        _error(req_id, -32601, f"Метод не підтримується: {method}")


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        try:
            _handle(msg)
        except Exception as exc:  # noqa: BLE001 — сервер не має падати від одного битого запиту
            rid = msg.get("id") if isinstance(msg, dict) else None
            if rid is not None:
                _error(rid, -32603, f"Внутрішня помилка: {type(exc).__name__}")


if __name__ == "__main__":
    main()
