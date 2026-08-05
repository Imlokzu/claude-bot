"""
Реєстр тулзів і виконавець. JSON-схеми — сумісні з OpenAI function calling.
"""

from __future__ import annotations

import logging
from typing import Awaitable, Callable

from tools.currency import get_common_rates, get_rate
from tools.facts import get_fact
from tools.images import search_images
from tools.search import search_web
from tools.weather import get_weather
from tools import workspace_tools
import memory
import brain_context

log = logging.getLogger("virtual_bot.tools.registry")

ToolHandler = Callable[..., Awaitable[dict]]

_TOOL_SCHEMAS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "weather",
            "description": "Отримати поточну погоду та прогноз на 5 днів для міста.",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {
                        "type": "string",
                        "description": "Назва міста, наприклад Берлін, Київ, Львів.",
                    },
                },
                "required": ["city"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "memory_search",
            "description": "Знайти раніше збережені факти про користувача та релевантні нотатки памʼяті.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Факт або тема для пошуку в памʼяті."},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "currency",
            "description": "Отримати актуальний курс валюти.",
            "parameters": {
                "type": "object",
                "properties": {
                    "base": {
                        "type": "string",
                        "description": "Базова валюта, наприклад USD, EUR.",
                    },
                    "target": {
                        "type": "string",
                        "description": "Цільова валюта, наприклад UAH. За замовчуванням UAH.",
                    },
                },
                "required": ["base"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "facts",
            "description": "Отримати короткий факт або визначення з Вікіпедії.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Тема, наприклад 'Україна', 'Штучний інтелект', 'Сонце'.",
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Знайти актуальну інформацію в інтернеті, щоб не вигадувати факти.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Запит для пошуку, наприклад 'останні новини України', 'Python 3.13 release date'.",
                    },
                    "count": {
                        "type": "integer",
                        "description": "Скільки результатів повернути (1-5). За замовчуванням 3.",
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "image_search",
            "description": (
                "Знайти картинки в інтернеті. Повертає прямі https-посилання. "
                "ОБОВʼЯЗКОВО вставляй знайдене у відповідь як ![підпис](посилання) — інакше користувач побачить лише текст. У квадратних дужках пиши КОРОТКИЙ ЗМІСТОВНИЙ підпис саме цієї картинки (напр. «Porsche 911 Carrera», «краб-привид на піску»), а не загальний запит: коли картинок кілька, підпис — єдине, з чого видно, що на кожній."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Що показати, напр. 'піксельний краб'."},
                    "count": {"type": "integer", "description": "Скільки картинок (1-6), типово 3."},
                },
                "required": ["query"],
            },
        },
    },
    {"type": "function", "function": {"name": "create_brain_directory", "description": "Create a directory inside brain/ only.", "parameters": {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]}}},
    {"type": "function", "function": {"name": "create_brain_file", "description": "Create a file inside brain/ only.", "parameters": {"type": "object", "properties": {"path": {"type": "string"}, "content": {"type": "string"}, "overwrite": {"type": "boolean"}}, "required": ["path", "content"]}}},
    {"type": "function", "function": {"name": "list_brain_navigation", "description": "Regenerate and return brain navigation.", "parameters": {"type": "object", "properties": {}}}},
    # Власна тека бота на диску: файли, проєкти, ігри, тека сесії
    *workspace_tools.SCHEMAS,
]

async def _currency_handler(base: str, target: str = "UAH") -> dict:
    """Обробляє запит курсу: якщо target не вказано, повертає кілька популярних курсів."""
    target = (target or "UAH").strip().upper()
    base = base.strip().upper()
    if not target or not base:
        return {"error": "Вкажи валюту"}
    return await get_rate(base, target)


async def _create_brain_directory(path: str) -> dict:
    return {"ok": True, "path": memory.create_brain_directory(path)}


async def _create_brain_file(path: str, content: str, overwrite: bool = False) -> dict:
    return {"ok": True, "path": memory.create_brain_file(path, content, overwrite=overwrite)}


async def _list_brain_navigation() -> dict:
    return {"ok": True, "path": "_navigation.md", "content": memory.regenerate_brain_navigation()}


async def _memory_search(query: str) -> dict:
    query = (query or "").strip()
    if not query:
        return {"error": "Вкажи, що шукати в памʼяті"}
    owner_root = brain_context.init_user_brain(None)
    profile = memory.load_user_profile()
    owner_profile = memory.load_user_profile(owner_root)
    if owner_profile and owner_profile not in profile:
        profile = f"{profile}\n{owner_profile}".strip()
    return {
        "profile": profile,
        "notes": _merge_memory_notes(
            memory.find_relevant_notes(query, top_n=3, root=owner_root),
            memory.find_relevant_notes(query, top_n=3),
        ),
    }


def _merge_memory_notes(*groups: list[dict]) -> list[dict]:
    """Merge session and canonical owner results without duplicate paths."""
    merged: list[dict] = []
    seen: set[str] = set()
    for group in groups:
        for note in group:
            path = note.get("path", "")
            if path in seen:
                continue
            seen.add(path)
            merged.append(note)
            if len(merged) == 3:
                return merged
    return merged


_HANDLERS: dict[str, ToolHandler] = {
    "weather": get_weather,
    "currency": _currency_handler,
    "facts": get_fact,
    "memory_search": _memory_search,
    "web_search": search_web,
    "image_search": search_images,
    "create_brain_directory": _create_brain_directory,
    "create_brain_file": _create_brain_file,
    "list_brain_navigation": _list_brain_navigation,
    **workspace_tools.HANDLERS,
}


def list_tools() -> list[dict]:
    """Повертає JSON-схеми тулзів для LLM."""
    return list(_TOOL_SCHEMAS)


def _tool_names() -> list[str]:
    return [t["function"]["name"] for t in _TOOL_SCHEMAS]


async def execute_tool(name: str, args: dict) -> dict:
    """Виконує тулзу за ім'ям. Повертає dict (з error при невдачі)."""
    name = (name or "").strip().lower()
    if name not in _HANDLERS:
        return {"error": f"Невідомий інструмент: {name}. Доступні: {', '.join(_tool_names())}"}

    args = args or {}
    handler = _HANDLERS[name]
    try:
        return await handler(**args)
    except Exception as exc:
        log.exception("Tool %s failed", name)
        return {"error": f"Помилка виконання інструменту {name}: {type(exc).__name__}"}


__all__ = ["list_tools", "execute_tool"]
