#!/usr/bin/env python3
"""
«Клод Бот» — workspace-MCP: stdio-MCP-сервер (без залежностей), який дає
OpenClaw-агенту його ВЛАСНУ робочу теку на диску.

Навіщо окремий сервер: тули з tools/registry.py бачить лише локальний мозок
Virtual Bot. Коли активний мозок — OpenClaw, він ходить власним набором
інструментів, тому доступ до теки треба віддати йому так само, як емоції
(див. emotions_mcp.py). Сервер нічого не робить сам: він лише проксює виклики
на /api/tools/call — уся перевірка шляхів лишається на бекенді.

Саме /api/tools/call, а НЕ /api/workspace/* напряму: ці REST-ендпоінти
призначені для браузера й вимагають справжній Clerk Bearer-токен
(_require_user). Цей MCP — локальний stdio-процес без браузерної сесії, тож
токена в нього ніколи не буде — прямий виклик /api/workspace/* впав би на
401 "Потрібен вхід (Clerk)" завжди, незалежно від того, чи залогінений
власник у дашборді. /api/tools/call стоїть за _tool_caller, який саме для
таких локальних мостів (loopback без токена) пускає виклик без 401.

Протокол: MCP поверх stdio = JSON-RPC 2.0, роздільник — новий рядок.

Реєстрація в OpenClaw:
  openclaw mcp add workspace --command python3 --arg /абс/шлях/workspace_mcp.py \
    --env VBOT_URL=http://127.0.0.1:8100
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

VBOT_URL = os.environ.get("VBOT_URL", "http://127.0.0.1:8100").rstrip("/")
# Сесія, у теку якої писати за префіксом `session/` (порожня → sessions/default)
VBOT_SESSION = os.environ.get("VBOT_SESSION", "")
PROTOCOL_VERSION = "2024-11-05"

TOOLS = [
    {
        "name": "workspace_show",
        "description": (
            "ПОКАЗАТИ користувачу файл із робочої теки прямо в панелі: сайт відкриється "
            "сторінкою, картинка — зображенням, нотатка — текстом. Використовуй ЗАВЖДИ, коли "
            "просять «відкрий» чи «покажи» — НЕ диктуй команди для термінала, ти можеш показати сам."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {"path": {"type": "string", "description": "Напр. 'projects/cats/index.html'."}},
            "required": ["path"],
        },
    },
    {
        "name": "workspace_info",
        "description": "Де на диску власна робоча тека бота, які в ній розділи і яка тека поточної сесії.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "workspace_list",
        "description": "Показати вміст теки в робочій теці. path='' — корінь, 'session' — тека розмови.",
        "inputSchema": {
            "type": "object",
            "properties": {"path": {"type": "string", "description": "Відносний шлях, напр. 'games'."}},
        },
    },
    {
        "name": "workspace_read",
        "description": "Прочитати текстовий файл із робочої теки.",
        "inputSchema": {
            "type": "object",
            "properties": {"path": {"type": "string"}},
            "required": ["path"],
        },
    },
    {
        "name": "workspace_write",
        "description": (
            "Створити або перезаписати файл у робочій теці (теки створюються самі). "
            "Префікс 'session/' — тека поточної розмови, 'games/' — ігри, 'notes/' — нотатки."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Напр. 'games/snake/index.html'."},
                "content": {"type": "string", "description": "Повний текст файлу."},
                "append": {"type": "boolean", "description": "Дописати в кінець замість перезапису."},
            },
            "required": ["path", "content"],
        },
    },
    {
        "name": "workspace_mkdir",
        "description": "Створити теку в робочій теці.",
        "inputSchema": {
            "type": "object",
            "properties": {"path": {"type": "string"}},
            "required": ["path"],
        },
    },
    {
        "name": "workspace_delete",
        "description": "Прибрати файл або теку в .trash (назавжди нічого не стирається).",
        "inputSchema": {
            "type": "object",
            "properties": {"path": {"type": "string"}},
            "required": ["path"],
        },
    },
]

_TOOL_NAMES = {t["name"] for t in TOOLS}


def _call(name: str, args: dict) -> dict:
    """Проксіює виклик на /api/tools/call; будь-яка помилка → {'error': ...}, MCP не падає."""
    body = {"name": name, "args": args, "session_id": VBOT_SESSION}
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        f"{VBOT_URL}/api/tools/call", data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8")).get("result", {})
    except urllib.error.HTTPError as exc:
        try:
            detail = json.loads(exc.read().decode("utf-8")).get("detail", "")
        except Exception:  # noqa: BLE001
            detail = ""
        return {"error": detail or f"HTTP {exc.code}"}
    except Exception as exc:  # noqa: BLE001 — панель могла бути вимкнена
        return {"error": f"Панель недоступна ({type(exc).__name__})"}


def _send(msg: dict) -> None:
    sys.stdout.write(json.dumps(msg, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _result(req_id, result: dict) -> None:
    _send({"jsonrpc": "2.0", "id": req_id, "result": result})


def _error(req_id, code: int, message: str) -> None:
    _send({"jsonrpc": "2.0", "id": req_id, "error": {"code": code, "message": message}})


def _handle(msg: dict) -> None:
    method = msg.get("method")
    req_id = msg.get("id")

    if req_id is None and method and method.startswith("notifications/"):
        return

    if method == "initialize":
        _result(req_id, {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "klod-bot-workspace", "version": "1.0.0"},
        })
    elif method == "ping":
        _result(req_id, {})
    elif method == "tools/list":
        _result(req_id, {"tools": TOOLS})
    elif method == "tools/call":
        params = msg.get("params") or {}
        name = params.get("name")
        if name not in _TOOL_NAMES:
            _error(req_id, -32602, f"Невідомий інструмент: {name}")
            return
        payload = _call(name, params.get("arguments") or {})
        _result(req_id, {
            "content": [{"type": "text", "text": json.dumps(payload, ensure_ascii=False)}],
            "isError": bool(payload.get("error")),
        })
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
        except Exception as exc:  # noqa: BLE001 — один битий запит не валить сервер
            rid = msg.get("id") if isinstance(msg, dict) else None
            if rid is not None:
                _error(rid, -32603, f"Внутрішня помилка: {type(exc).__name__}")


if __name__ == "__main__":
    main()
