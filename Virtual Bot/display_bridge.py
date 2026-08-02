"""
«Клод Бот» — Virtual Bot: міст до дисплея (claude-bot-display, 127.0.0.1:8001).

Механізм доставки: бекенд дисплея приймає події від БУДЬ-ЯКОГО клієнта свого
WebSocket /ws/display і ретранслює їх усім підключеним (так працюють його
backend/send_event.py і тести test_websocket_broadcast). Тож ми відкриваємо
коротке WS-з'єднання, шлемо JSON-події за контрактом API_CONTRACT.md
(heard / speaking / emotion_change) і закриваємось.

Критично: міст НЕ БЛОКУЄ чат —
- усі відправки йдуть fire-and-forget фоновими задачами (send_*_bg);
- сумарний таймаут на відправку ≤ 1.5 с;
- будь-які помилки тихо логуються (display офлайн → просто пропускаємо).
Стан моста (активний/офлайн, остання помилка) — get_bridge_status().
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any

import websockets

import app_config as cfg

log = logging.getLogger("virtual_bot.display_bridge")

# WS-адреса дисплея з config.yaml (http://... → ws://...)
WS_URL = (
    cfg.DISPLAY_BASE_URL.replace("https://", "wss://").replace("http://", "ws://")
    + "/ws/display"
)
# Загальний таймаут однієї відправки (конект + send), секунди
TIMEOUT_S = min(1.5, float(cfg.cfg("display", "bridge_timeout_s", default=1.5)))

# Емоції, які підтримує display (15 штук, з його API_CONTRACT.md)
_DISPLAY_EMOTIONS = {
    "neutral", "idle", "listening", "thinking", "speaking", "happy", "excited",
    "surprised", "shocked", "angry", "sad", "sleepy", "confused", "love", "suspicious",
}

# Стан моста — доступний усередині процесу через get_bridge_status()
_state: dict[str, Any] = {
    "active": False,        # чи вдалася остання відправка
    "last_error": None,     # текст останньої помилки (або None)
    "last_success_ts": None,  # time.time() останньої вдалої відправки
}

# Фонові задачі відправки — тримаємо посилання, щоб їх не зібрав GC
_bg_tasks: set[asyncio.Task] = set()


def map_emotion(emotion: str) -> str:
    """
    Мапить емоцію Virtual Bot на емоцію display.
    Усі 10 наших емоцій є серед 15 display'я, тож збіг прямий;
    будь-що невідоме → neutral.
    """
    return emotion if emotion in _DISPLAY_EMOTIONS else "neutral"


def get_bridge_status() -> dict[str, Any]:
    """Поточний стан моста (копія, безпечно віддавати назовні процесу)."""
    return dict(_state)


async def _send_messages(messages: list[dict]) -> None:
    """
    Одна коротка WS-сесія: конект → надіслати всі події → закрити.
    Ніколи не кидає виняток; помилки лише оновлюють стан і тихо логуються.
    """
    try:
        async def _do() -> None:
            # proxy=None: дисплей завжди локальний (127.0.0.1) — системний
            # HTTP-проксі macOS сюди пхати не можна (localhost часто нема
            # у винятках проксі, і конект «зависав» би або падав)
            async with websockets.connect(
                WS_URL, open_timeout=TIMEOUT_S, close_timeout=0.5, proxy=None
            ) as ws:
                for message in messages:
                    await ws.send(json.dumps(message, ensure_ascii=False))
                # Сервер дисплея ретранслює кожну подію всім клієнтам, включно
                # з нами. Якщо закрити з'єднання одразу після send, close може
                # «обігнати» ще не оброблені кадри і сервер їх втратить. Тому
                # чекаємо відлуння нашої ОСТАННЬОЇ події (з дедлайном) —
                # це гарантія, що сервер обробив усе надіслане.
                loop = asyncio.get_running_loop()
                deadline = loop.time() + min(0.8, TIMEOUT_S)
                while True:
                    remaining = deadline - loop.time()
                    if remaining <= 0:
                        break
                    try:
                        raw = await asyncio.wait_for(ws.recv(), timeout=remaining)
                    except asyncio.TimeoutError:
                        break
                    try:
                        if json.loads(raw) == messages[-1]:
                            break
                    except ValueError:
                        continue  # чужий/битий кадр (напр., clock_tick) — далі

        # Загальна стеля однієї відправки — TIMEOUT_S (≤1.5 с)
        await asyncio.wait_for(_do(), timeout=TIMEOUT_S)
    except Exception as exc:  # noqa: BLE001 — display офлайн = норма, чат не чіпаємо
        was_active = _state["active"]
        _state["active"] = False
        _state["last_error"] = f"{type(exc).__name__}: {exc}"
        if was_active:
            log.info("Дисплей став недоступний — міст на паузі (%s)", type(exc).__name__)
        else:
            log.debug("Дисплей недоступний (%s) — подію пропущено", type(exc).__name__)
        return

    if not _state["active"]:
        log.info("Міст до дисплея активний (%s)", WS_URL)
    _state["active"] = True
    _state["last_error"] = None
    _state["last_success_ts"] = time.time()


def _spawn(coro) -> None:
    """Fire-and-forget: запускає відправку фоном, не блокуючи виклик."""
    try:
        task = asyncio.create_task(coro)
    except RuntimeError:
        # Немає запущеного event loop (наприклад, sync-контекст) — пропускаємо
        coro.close()
        log.debug("Немає event loop — подію для дисплея пропущено")
        return
    _bg_tasks.add(task)
    task.add_done_callback(_bg_tasks.discard)


async def shutdown() -> None:
    """
    Скасовує всі незавершені фонові відправки (викликати на shutdown).
    Кожна відправка й так має стелю ≤1.5 с, але на виході не чекаємо навіть її:
    жодна WS-сесія до дисплея не має тримати процес.
    """
    pending = [task for task in _bg_tasks if not task.done()]
    for task in pending:
        task.cancel()
    if pending:
        await asyncio.gather(*pending, return_exceptions=True)
        log.info("Скасовано %d фонових відправок на дисплей", len(pending))


def send_chat_exchange_bg(user_text: str, reply_text: str, emotion: str) -> None:
    """Після відповіді /api/chat: heard (користувач) + speaking (бот) + емоція."""
    _spawn(_send_messages([
        {"type": "heard", "data": {"text": user_text}},
        {"type": "speaking", "data": {"text": reply_text}},
        {"type": "emotion_change", "data": {"emotion": map_emotion(emotion)}},
    ]))


def send_say_bg(text: str, emotion: str) -> None:
    """Бот сам щось каже (напр., привітання із зору): speaking + емоція."""
    _spawn(_send_messages([
        {"type": "speaking", "data": {"text": text}},
        {"type": "emotion_change", "data": {"emotion": map_emotion(emotion)}},
    ]))


def send_emotion_bg(emotion: str) -> None:
    """Лише зміна емоції на дисплеї."""
    _spawn(_send_messages([
        {"type": "emotion_change", "data": {"emotion": map_emotion(emotion)}},
    ]))
