"""
«Клод Бот» — Virtual Bot: трасування ходу розмови для окремої консолі.

ЗАЧИМ ЦЕ ОКРЕМО ВІД console_log.py
----------------------------------
`console_log` віддає РЯДКИ логів — плаский потік тексту. Щоб побачити «що де
як іде», цього мало: у якому порядку пробувались мозки, скільки тривала кожна
спроба, чому вона впала, який тул смикнув бот і скільки зайняло розпізнавання
голосу. Тут — СТРУКТУРА: кожна репліка це «хід» (turn) зі списком кроків.

Контракт SSE (та сама стрічка /api/events, тип "trace"):
- {"type":"trace","event":"turn_start","turn":{...}}
- {"type":"trace","event":"step","turn_id":"t12"|null,"step":{...}}
- {"type":"trace","event":"turn_end","turn":{...}}

Крок: {"t":<unix>,"stage":"brain|tool|asr|tts","name":str,
       "state":"start|ok|fail|skip","detail":str,"ms":float|null}

Історія для щойно відкритої консолі — GET /api/trace.

Кроки БЕЗ активного ходу (тул, який смикнув зовнішній мозок окремим HTTP-
запитом; розпізнавання голосу до відправки репліки) не губляться: вони йдуть
у власне кільце `_loose` і показуються в стрічці за часом.

Модуль НІКОЛИ не кидає виняток назовні: трасування не має права зламати чат.
"""

from __future__ import annotations

import itertools
import logging
import threading
import time
from collections import deque
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Iterator

import events

log = logging.getLogger("virtual_bot.trace")

# Скільки ходів і «вільних» кроків тримаємо для історії консолі
_MAX_TURNS = 60
_MAX_LOOSE = 200

_turns: deque[dict] = deque(maxlen=_MAX_TURNS)
_loose: deque[dict] = deque(maxlen=_MAX_LOOSE)
_by_id: dict[str, dict] = {}
_lock = threading.Lock()
_counter = itertools.count(1)

# Поточний хід. ContextVar, а не глобальна змінна: паралельні запити різних
# користувачів не мають перемішувати свої кроки (те саме міркування, що й у
# brain_context). У генераторі FastAPI контекст не успадковується — там
# викликач перевʼязує хід явно через bind().
_current: ContextVar[dict | None] = ContextVar("trace_turn", default=None)


def _cut(value, limit: int) -> str:
    """Рядок обмеженої довжини (у консоль не тягнемо мегабайти)."""
    return str(value or "")[:limit]


def start_turn(source: str, text: str = "", session: str = "", model: str = "") -> str:
    """
    Починає хід (одна репліка користувача) і повертає його id.

    Сам ContextVar НЕ чіпає — привʼязка робиться через bind(), щоб працювало
    і в звичайному обробнику, і всередині стрімового генератора.
    """
    try:
        turn = {
            "id": f"t{next(_counter)}",
            "t": time.time(),
            "source": _cut(source, 20),
            "session": _cut(session, 64),
            "text": _cut(text, 400),
            "steps": [],
            "done": False,
            "mode": "",
            "model": _cut(model, 80),
            "emotion": "",
            "error": "",
            "ms": None,
        }
        with _lock:
            _turns.append(turn)
            _by_id[turn["id"]] = turn
            # _by_id не має рости вічно: тримаємо лише те, що є в кільці
            if len(_by_id) > _MAX_TURNS * 2:
                alive = {t["id"] for t in _turns}
                for key in [k for k in _by_id if k not in alive]:
                    _by_id.pop(key, None)
        events.publish({"type": "trace", "event": "turn_start", "turn": _public(turn)})
        return turn["id"]
    except Exception:  # noqa: BLE001 — трасування не має права зламати чат
        log.debug("start_turn не спрацював", exc_info=True)
        return ""


@contextmanager
def bind(turn_id: str) -> Iterator[None]:
    """Робить хід поточним для цього контексту (кроки чіпляються до нього)."""
    turn = _by_id.get(turn_id) if turn_id else None
    token = _current.set(turn)
    try:
        yield
    finally:
        _current.reset(token)


def current_id() -> str:
    """Id поточного ходу або порожній рядок."""
    turn = _current.get()
    return turn["id"] if turn else ""


def step(stage: str, name: str, state: str = "ok", detail: str = "", ms: float | None = None) -> None:
    """
    Додає крок до поточного ходу (або у «вільні», якщо ходу нема).

    stage: brain | tool | asr | tts | memory
    state: start | ok | fail | skip
    """
    try:
        # Тривалість рахує викликач — і може підсунути що завгодно. Крок без
        # часу все одно корисний, тож кривий ms НЕ має коштувати нам цілого
        # рядка в консолі (саме так поводився перший варіант).
        try:
            ms_value = round(float(ms), 1) if ms is not None else None
        except (TypeError, ValueError):
            ms_value = None
        entry = {
            "t": time.time(),
            "stage": _cut(stage, 16),
            "name": _cut(name, 60),
            "state": state if state in ("start", "ok", "fail", "skip") else "ok",
            "detail": _cut(detail, 200),
            "ms": ms_value,
        }
        turn = _current.get()
        with _lock:
            if turn is not None:
                turn["steps"].append(entry)
            else:
                _loose.append(entry)
        events.publish({
            "type": "trace",
            "event": "step",
            "turn_id": turn["id"] if turn else None,
            "step": entry,
        })
    except Exception:  # noqa: BLE001
        log.debug("step не спрацював", exc_info=True)


def end_turn(mode: str = "", model: str = "", emotion: str = "", error: str = "") -> None:
    """Закриває поточний хід: чим відповіли, скільки це зайняло."""
    try:
        turn = _current.get()
        if turn is None or turn.get("done"):
            return
        with _lock:
            turn["done"] = True
            turn["mode"] = _cut(mode, 20)
            turn["model"] = _cut(model, 80) or turn.get("model", "")
            turn["emotion"] = _cut(emotion, 20)
            turn["error"] = _cut(error, 200)
            turn["ms"] = round((time.time() - turn["t"]) * 1000, 1)
        events.publish({"type": "trace", "event": "turn_end", "turn": _public(turn)})
    except Exception:  # noqa: BLE001
        log.debug("end_turn не спрацював", exc_info=True)


def _public(turn: dict) -> dict:
    """Копія ходу для відправки (щоб приймач не тримав живий словник)."""
    return {**turn, "steps": list(turn["steps"])}


def recent() -> dict:
    """Історія для щойно відкритої консолі: ходи + вільні кроки."""
    with _lock:
        return {
            "turns": [_public(t) for t in _turns],
            "events": list(_loose),
        }


def reset() -> None:
    """Очищає історію (тести й кнопка «Очистити» в консолі)."""
    with _lock:
        _turns.clear()
        _loose.clear()
        _by_id.clear()
