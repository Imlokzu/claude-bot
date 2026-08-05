"""
«Клод Бот» — Virtual Bot: SSE-шина живих подій (GET /api/events).

Спільний контракт із фронтендом (кожна подія — рядок "data: <JSON>\n\n"):
- {"type": "emotion", "emotion": "<одна з 10>"}          — зміна емоції обличчя
- {"type": "say", "text": "...", "emotion": "<...>"}     — бот сам щось каже
- {"type": "vision", "event": "face_appeared"|"face_gone"|"motion", "faces": N}
- {"type": "log", "t": <unix>, "level": "...", "name": "...", "msg": "..."} — рядок консолі

Keep-alive: коментар ": ping\n\n" кожні ~15 секунд.
Кілька клієнтів підтримуються (у кожного своя asyncio.Queue);
відвалений клієнт прибирається у finally і не тече.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections import deque
from typing import AsyncIterator

from emotions import ALLOWED_EMOTIONS

log = logging.getLogger("virtual_bot.events")

# Інтервал keep-alive пінгів (секунди)
KEEPALIVE_S = 15.0
# Максимум подій у черзі одного клієнта; переповнення = клієнт не читає —
# нові події для нього тихо відкидаємо, інших клієнтів це не блокує.
_QUEUE_MAX = 200

# Черги активних підписників (по одній на SSE-клієнта)
_subscribers: set[asyncio.Queue] = set()

# Сентинел «потік завершено»: close_all() кладе його в кожну чергу,
# генератор sse_stream, побачивши його, негайно завершується.
_CLOSE = object()
# True після close_all(): нові підписники не приймаються, наявні завершуються.
_shutting_down = False


def close_all() -> None:
    """
    Закриває ВСІ активні SSE-потоки (викликати на shutdown; ідемпотентно).

    Без цього graceful shutdown uvicorn БЕЗ --timeout-graceful-shutdown висів
    би вічно: він чекає завершення відкритих з'єднань ПЕРЕД lifespan shutdown,
    а «вічний» /api/events сам ніколи не завершується. Тому будимо кожен
    генератор сентинелом — потік завершується, з'єднання закривається,
    і shutdown проходить за долі секунди.
    """
    global _shutting_down
    _shutting_down = True
    for queue in list(_subscribers):
        try:
            queue.put_nowait(_CLOSE)
        except asyncio.QueueFull:
            # Черга забита — звільняємо одне місце: сентинел важливіший за подію
            try:
                queue.get_nowait()
                queue.put_nowait(_CLOSE)
            except Exception:  # noqa: BLE001 — на шатдауні головне не впасти
                pass
        except Exception:  # noqa: BLE001
            pass


def publish(payload: dict) -> None:
    """
    Розсилає подію всім підписникам. Ніколи не кидає виняток і не блокує:
    переповнену чергу конкретного клієнта просто пропускаємо.
    """
    for queue in list(_subscribers):
        try:
            queue.put_nowait(payload)
        except asyncio.QueueFull:
            log.debug("Черга SSE-клієнта переповнена — подію пропущено")
        except Exception:  # noqa: BLE001 — шина не має права валити відправника
            log.debug("Не вдалося покласти подію в чергу клієнта", exc_info=True)


def publish_emotion(emotion: str) -> None:
    """Подія зміни емоції обличчя (невідома емоція → idle)."""
    if emotion not in ALLOWED_EMOTIONS:
        emotion = "idle"
    publish({"type": "emotion", "emotion": emotion})


def publish_say(text: str, emotion: str) -> None:
    """Бот сам щось каже: бульбашка бота в чаті + емоція."""
    if emotion not in ALLOWED_EMOTIONS:
        emotion = "speaking"
    publish({"type": "say", "text": text, "emotion": emotion})


def publish_tool(tool: str, detail: str = "", state: str = "start") -> None:
    """
    Бот скористався інструментом. Потрібно, коли тули виконує НЕ панель, а
    зовнішній мозок (OpenClaw через tools_mcp) — інакше в панелі не було б
    видно ні що він шукає, ні що взагалі щось робить.
    """
    publish({
        "type": "tool",
        "tool": str(tool)[:60],
        "detail": str(detail)[:160],
        "state": "done" if state == "done" else "start",
    })


def publish_vision(event: str, faces: int) -> None:
    """Подія зору: face_appeared | face_gone | motion."""
    publish({"type": "vision", "event": event, "faces": int(faces)})


# Кільцевий буфер останніх лог-рядків для консолі (історія при завантаженні панелі)
_LOG_RING: deque = deque(maxlen=400)


def publish_log(entry: dict) -> None:
    """
    Додає рядок у консоль: у кільцевий буфер історії + жива SSE-подія
    {"type":"log", ...}. Викликається з консольного лог-хендлера (console_log.py).
    """
    _LOG_RING.append(entry)
    publish({"type": "log", **entry})


def recent_logs() -> list:
    """Останні лог-рядки консолі (для початкового завантаження)."""
    return list(_LOG_RING)


def subscribers_count() -> int:
    """Кількість активних SSE-клієнтів (для діагностики зсередини процесу)."""
    return len(_subscribers)


async def sse_stream() -> AsyncIterator[str]:
    """
    Генератор тіла text/event-stream для одного клієнта.

    Кожна подія — "data: <JSON>\n\n"; без подій — keep-alive ": ping\n\n"
    кожні ~15 с. При відключенні клієнта (закритті генератора) підписка
    гарантовано прибирається у finally. На shutdown застосунку close_all()
    будить генератор сентинелом — потік завершується сам, не тримаючи сервер.
    """
    if _shutting_down:
        return  # застосунок уже завершується — нових потоків не відкриваємо
    queue: asyncio.Queue = asyncio.Queue(maxsize=_QUEUE_MAX)
    _subscribers.add(queue)
    log.info("SSE-клієнт підключився (усього: %d)", len(_subscribers))
    try:
        # Одразу шлемо коментар, щоб проксі/браузер відкрили потік
        yield ": ping\n\n"
        while not _shutting_down:
            try:
                payload = await asyncio.wait_for(queue.get(), timeout=KEEPALIVE_S)
            except asyncio.TimeoutError:
                yield ": ping\n\n"
                continue
            if payload is _CLOSE or _shutting_down:
                break
            yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
    finally:
        _subscribers.discard(queue)
        log.info("SSE-клієнт відключився (усього: %d)", len(_subscribers))
