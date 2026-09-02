"""
Тули «жвавого інтерфейсу»: бот малює в чаті елементи, а не описує їх текстом.

Навіщо: питання на кшталт «яку версію робимо — A чи B?» бот досі писав
звичайним текстом, і користувач мусив надрукувати відповідь руками. Тепер
питання приходить карткою з кнопками, а список справ — справжнім чеклістом.

Елементи летять у панель SSE-подією {"type": "ui", ...}; сам тул одразу
повертає «показано» і НЕ чекає на відповідь — інакше він блокував би мозок,
а відповідь користувача все одно приходить звичайним повідомленням у чат.
"""

from __future__ import annotations

import logging
import uuid

import events

log = logging.getLogger("virtual_bot.tools.ui")

MAX_OPTIONS = 6
MAX_ITEMS = 20


def _clean(text: object, limit: int = 200) -> str:
    return " ".join(str(text or "").split())[:limit]


async def ask_question(
    question: str,
    options: list | None = None,
    allow_custom: bool = True,
) -> dict:
    """Питання з варіантами відповіді — картка з кнопками в чаті."""
    text = _clean(question, 400)
    if not text:
        return {"error": "Потрібен текст питання"}
    items = [_clean(o, 120) for o in (options or []) if _clean(o, 120)][:MAX_OPTIONS]
    payload = {
        "id": uuid.uuid4().hex[:12],
        "question": text,
        "options": items,
        "allow_custom": bool(allow_custom),
    }
    events.publish_ui("question", payload)
    return {
        "ok": True,
        "shown": "question",
        "note": "Питання показано користувачу кнопками. Його відповідь прийде звичайним повідомленням — просто чекай на неї, не перепитуй текстом.",
    }


async def todo_list(title: str = "", items: list | None = None) -> dict:
    """Список справ — інтерактивний чекліст (галочки ставить користувач)."""
    entries = []
    for item in (items or [])[:MAX_ITEMS]:
        if isinstance(item, dict):
            text = _clean(item.get("text"))
            done = bool(item.get("done"))
        else:
            text = _clean(item)
            done = False
        if text:
            entries.append({"text": text, "done": done})
    if not entries:
        return {"error": "Потрібен хоча б один пункт"}
    payload = {"id": uuid.uuid4().hex[:12], "title": _clean(title, 120), "items": entries}
    events.publish_ui("todo", payload)
    return {"ok": True, "shown": "todo", "count": len(entries)}


async def show_choice(title: str, options: list) -> dict:
    """Кілька карток на вибір: назва + короткий опис (напр. варіанти дизайну)."""
    cards = []
    for option in (options or [])[:MAX_OPTIONS]:
        if isinstance(option, dict):
            label = _clean(option.get("label") or option.get("title"), 80)
            desc = _clean(option.get("description"), 200)
        else:
            label, desc = _clean(option, 80), ""
        if label:
            cards.append({"label": label, "description": desc})
    if not cards:
        return {"error": "Потрібні варіанти"}
    payload = {"id": uuid.uuid4().hex[:12], "title": _clean(title, 160), "options": cards}
    events.publish_ui("choice", payload)
    return {"ok": True, "shown": "choice", "note": "Вибір користувача прийде повідомленням."}


SCHEMAS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "ask_question",
            "description": (
                "Поставити користувачу питання КАРТКОЮ З КНОПКАМИ замість звичайного тексту. "
                "Використовуй ЗАВЖДИ, коли пропонуєш вибір або перепитуєш уточнення — "
                "натиснути кнопку швидше, ніж друкувати. Відповідь прийде окремим повідомленням."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "question": {"type": "string", "description": "Саме питання."},
                    "options": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Варіанти відповіді (до 6), напр. ['Так', 'Ні', 'Пізніше'].",
                    },
                    "allow_custom": {
                        "type": "boolean",
                        "description": "Чи лишати поле для власної відповіді. Типово так.",
                    },
                },
                "required": ["question"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "todo_list",
            "description": (
                "Показати список справ інтерактивним чеклістом — коли плануєш роботу або "
                "перелічуєш кроки. Користувач сам ставить галочки."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Заголовок списку."},
                    "items": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Пункти (до 20).",
                    },
                },
                "required": ["items"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "show_choice",
            "description": (
                "Показати кілька варіантів картками з описом (напр. варіанти дизайну чи підходу). "
                "Користувач обирає кліком."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "options": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "label": {"type": "string"},
                                "description": {"type": "string"},
                            },
                            "required": ["label"],
                        },
                    },
                },
                "required": ["title", "options"],
            },
        },
    },
]

HANDLERS = {
    "ask_question": ask_question,
    "todo_list": todo_list,
    "show_choice": show_choice,
}
