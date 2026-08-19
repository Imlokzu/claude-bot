"""
Тул «покажи на екрані»: бот сам перемикає екран пристрою (/screen).

Навіщо: у бота є фізичний екран, і на прохання «покажи годинник» він досі
міг лише описати його словами. Тепер він перемикає екран насправді —
подією SSE {"type": "screen", "screen": ...}, яку слухає сама сторінка.

Тул НЕ чекає підтвердження від екрана: якщо його зараз ніхто не показує
(бот без дисплея, вкладка закрита), подія просто нікуди не прийде — це не
помилка, а звичайний стан для «софт спочатку, залізо потім».
"""

from __future__ import annotations

import logging

import events

log = logging.getLogger("virtual_bot.tools.screen")

# Ключ — те, що каже мозок; значення — людська назва для відповіді.
SCREENS: dict[str, str] = {
    "face": "Обличчя",
    "clock": "Годинник",
    "say": "Остання репліка",
    "state": "Стан систем",
    "chat": "Розмова",
    "quick": "Швидкі дії",
    "memory": "Памʼять",
    "chats": "Розмови",
    "apps": "Усі застосунки",
}

# Синоніми українською: мозок цілком може сказати «годинник», а не "clock"
_ALIASES: dict[str, str] = {
    "обличчя": "face", "краб": "face", "морда": "face", "лице": "face",
    "годинник": "clock", "час": "clock", "time": "clock",
    "репліка": "say", "остання репліка": "say", "що сказав": "say",
    "стан": "state", "статус": "state", "status": "state",
    "розмова": "chat", "чат": "chat",
    "памʼять": "memory", "память": "memory", "нотатки": "memory", "notes": "memory", "memory": "memory",
    "розмови": "chats", "історія чатів": "chats", "історія": "chats", "chats": "chats", "history": "chats",
    "швидкі дії": "quick", "налаштування": "quick", "settings": "quick",
    "усі екрани": "apps", "всі екрани": "apps", "меню": "apps", "apps": "apps",
}


def resolve(name: object) -> str | None:
    """Назва екрана → канонічний id, або None якщо не впізнали."""
    key = " ".join(str(name or "").split()).lower()
    if not key:
        return None
    if key in SCREENS:
        return key
    return _ALIASES.get(key)


async def open_screen(screen: str) -> dict:
    """Перемикає екран пристрою на вказаний."""
    target = resolve(screen)
    if target is None:
        return {
            "error": "Невідомий екран",
            "available": sorted(SCREENS.keys()),
        }
    events.publish_screen(target)
    log.info("🖥 Екран → %s", target)
    return {"ok": True, "screen": target, "title": SCREENS[target]}


SCHEMAS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "open_screen",
            "description": (
                "Перемкнути ЕКРАН ПРИСТРОЮ бота на потрібний розділ. "
                "Використовуй, коли користувач просить щось показати на екрані "
                "(«покажи годинник», «відкрий стан», «покажи всі застосунки»). "
                "Це керує фізичним екраном бота, а не текстом у чаті."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "screen": {
                        "type": "string",
                        "description": (
                            "Який екран відкрити: face (обличчя), clock (годинник), "
                            "say (остання репліка), state (стан систем), chat (розмова), "
                            "quick (швидкі дії), memory (памʼять), chats (розмови), "
                            "apps (усі застосунки)."
                        ),
                    },
                },
                "required": ["screen"],
            },
        },
    },
]

HANDLERS = {
    "open_screen": open_screen,
}
