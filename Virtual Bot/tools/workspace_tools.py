"""
Тули роботи з власною текою бота (workspace/).

Шляхи — відносні до кореня workspace; `session/…` вказує на теку поточної
сесії. Уся перевірка безпеки шляхів — у workspace._resolve.
"""

from __future__ import annotations

import logging

import workspace

log = logging.getLogger("virtual_bot.tools.workspace")


async def ws_list(path: str = "") -> dict:
    try:
        return workspace.list_dir(path)
    except (ValueError, OSError) as exc:
        return {"error": str(exc)}


async def ws_read(path: str) -> dict:
    try:
        return workspace.read_file(path)
    except (ValueError, OSError) as exc:
        return {"error": str(exc)}


async def ws_write(path: str, content: str, append: bool = False) -> dict:
    try:
        return workspace.write_file(path, content, append=bool(append))
    except (ValueError, OSError) as exc:
        return {"error": str(exc)}


async def ws_mkdir(path: str) -> dict:
    try:
        return workspace.make_dir(path)
    except (ValueError, OSError) as exc:
        return {"error": str(exc)}


async def ws_delete(path: str) -> dict:
    try:
        return workspace.delete(path)
    except (ValueError, OSError) as exc:
        return {"error": str(exc)}


async def ws_info() -> dict:
    try:
        return workspace.info()
    except OSError as exc:
        return {"error": str(exc)}


SCHEMAS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "workspace_info",
            "description": (
                "Дізнатись, де на диску власна робоча тека бота, які в ній розділи "
                "і як називається тека поточної сесії."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "workspace_list",
            "description": "Показати вміст теки в робочій теці бота.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Відносний шлях, напр. '' (корінь), 'games', 'session'.",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "workspace_read",
            "description": "Прочитати текстовий файл із робочої теки.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Напр. 'notes/ідеї.md' або 'session/plan.md'."},
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "workspace_write",
            "description": (
                "Створити або перезаписати файл у робочій теці. Теки створюються самі. "
                "Префікс 'session/' — тека поточної розмови."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Напр. 'games/snake/index.html'."},
                    "content": {"type": "string", "description": "Повний текст файлу."},
                    "append": {"type": "boolean", "description": "Дописати в кінець замість перезапису."},
                },
                "required": ["path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "workspace_mkdir",
            "description": "Створити теку в робочій теці бота.",
            "parameters": {
                "type": "object",
                "properties": {"path": {"type": "string"}},
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "workspace_delete",
            "description": "Прибрати файл або теку в .trash (не стирає назавжди).",
            "parameters": {
                "type": "object",
                "properties": {"path": {"type": "string"}},
                "required": ["path"],
            },
        },
    },
]

HANDLERS = {
    "workspace_info": ws_info,
    "workspace_list": ws_list,
    "workspace_read": ws_read,
    "workspace_write": ws_write,
    "workspace_mkdir": ws_mkdir,
    "workspace_delete": ws_delete,
}
