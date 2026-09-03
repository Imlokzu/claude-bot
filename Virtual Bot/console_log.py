"""
«Клод Бот» — Virtual Bot: консоль.

Перехоплює логи застосунку (virtual_bot.*) і HTTP-клієнта (httpx) та транслює їх
у фронтенд — у кільцевий буфер історії (GET /api/console) і живою SSE-подією
{"type":"log", ...}. Так у панелі «Консоль» видно, КУДИ йде запит (httpx логи
з URL і статусом), який мозок відповів, події зору, попередження й помилки.

Секрети НЕ витікають: httpx логує лише METHOD + URL + статус (без заголовків/тіла),
а URL мозків — локальні або api.anthropic.com, без токенів.
"""

from __future__ import annotations

import logging

import events
import trace_log


def _is_noise(record: logging.LogRecord, msg: str) -> bool:
    """
    Періодичні health-check GET-и (опитування /api/status кожні 5с до всіх мозків)
    — шум, що топить корисне. Лишаємо POST (реальні виклики мозку) і будь-які
    не-2xx (помилки). Тобто ховаємо лише успішні GET від httpx.
    """
    if record.name.startswith("httpx") and msg.startswith("HTTP Request: GET "):
        return '"HTTP/1.1 2' in msg or '"HTTP/1.0 2' in msg
    return False


class _ConsoleHandler(logging.Handler):
    """Кладе кожен лог-рядок у консоль-шину (events.publish_log)."""

    def emit(self, record: logging.LogRecord) -> None:
        try:
            msg = record.getMessage()
            if _is_noise(record, msg):
                return
            events.publish_log({
                "t": record.created,
                "level": record.levelname,
                "name": record.name,
                "msg": msg,
                "session": trace_log.current_session(),
            })
        except Exception:  # noqa: BLE001 — консоль НІКОЛИ не має права зламати логер
            pass


_installed = False


def install() -> None:
    """
    Чіпляє консольний хендлер до логерів застосунку та httpx (ідемпотентно).
    Рівень INFO: показуємо запити, відповіді, попередження й помилки.
    """
    global _installed
    if _installed:
        return
    handler = _ConsoleHandler()
    handler.setLevel(logging.INFO)
    for name in ("virtual_bot", "httpx"):
        lg = logging.getLogger(name)
        lg.addHandler(handler)
        # httpx за замовчуванням мовчазний (WARNING) — вмикаємо INFO, щоб бачити запити
        if lg.level == logging.NOTSET or lg.level > logging.INFO:
            lg.setLevel(logging.INFO)
    _installed = True
