#!/usr/bin/env python3
"""
«Клод Бот» — youtube-MCP: stdio-MCP-сервер, який дає агенту повний пульт до
ВІДЕО на екрані бота: показати ролик, пауза, перемотка вперед/назад, стрибок
на час, у початок, у кінець, швидкість, звук — і адблок (пропуск вклеєної
реклами через SponsorBlock) разом із його налаштуваннями.

Навіщо окремий сервер, коли ті самі тули вже є в tools/registry.py: реєстр
бачить лише ЛОКАЛЬНИЙ мозок Virtual Bot. Коли активний мозок — OpenClaw, він
ходить власним набором інструментів, і без цього містка агент чесно казав би
«я не можу керувати твоїм екраном». Сервер нічого не рахує сам — лише проксює
виклики на /api/video/* та /api/music/search.

Рекламу, яку вставляє САМ YouTube, тут блокувати нічого: відео йде проксі-
потоком через бота, без плеєра YouTube, тож прероли й банери не доходять
взагалі. Адблок у цьому пульті — про рекламу, ВКЛЕЄНУ в саме відео.

Протокол: MCP поверх stdio = JSON-RPC 2.0, роздільник — новий рядок
(не LSP-фреймінг). Методи: initialize, tools/list, tools/call, ping;
нотифікації (notifications/*) тихо ігноруються.

Реєстрація в OpenClaw:
  openclaw mcp add youtube --command python3 --arg /абс/шлях/youtube_mcp.py \
    --env VBOT_URL=http://127.0.0.1:8100

Секретів немає. Бекенд офлайн — інструмент повертає текст про це, а не валить
сервер: агент мусить дізнатися, що екран недосяжний, а не втратити зʼєднання.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

VBOT_URL = os.environ.get("VBOT_URL", "http://127.0.0.1:8100").rstrip("/")
PROTOCOL_VERSION = "2024-11-05"
TIMEOUT_S = 20

# Дії плеєра — дублюємо контракт video_control.ACTIONS, щоб сервер лишався
# самодостатнім (його запускають окремим процесом, без імпорту бота).
ACTIONS = ["pause", "resume", "stop", "forward", "back", "seek",
           "restart", "end", "speed", "mute", "unmute", "captions_on", "captions_off"]

CATEGORIES = ["sponsor", "selfpromo", "interaction", "intro",
              "outro", "preview", "filler", "music_offtopic"]

TOOLS = [
    {
        "name": "play_video",
        "description": (
            "Показати ВІДЕО з YouTube на екрані бота — з КАРТИНКОЮ, на весь екран, "
            "з автоматичним пропуском вклеєної реклами. Використовуй на «покажи відео», "
            "«увімкни ролик», «постав на екран …», або коли дали посилання й хочуть ДИВИТИСЬ. "
            "Якщо просять музику у фоні (тільки звук) — це інший інструмент, play_music."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Що шукати, напр. «огляд Raspberry Pi 5»."},
                "url": {"type": "string", "description": "Пряме посилання: watch?v=… або youtu.be/…"},
                "start": {"type": "string", "description": "З якої хвилини почати, напр. «2:30». Не обовʼязково."},
            },
        },
    },
    {
        "name": "video_control",
        "description": (
            "Керувати відео, яке ВЖЕ грає на екрані: pause (пауза), resume (далі), "
            "stop (зупинити й закрити), forward/back (перемотати на seconds), "
            "seek (стрибнути на position, напр. «5:00»), restart (з початку), "
            "end (у кінець), speed (швидкість rate), mute/unmute (звук), "
            "captions_on/captions_off (субтитри). "
            "Використовуй на «стоп», «пауза», «перемотай вперед», «на 5 хвилині», «в кінець»."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ACTIONS, "description": "Що зробити з плеєром."},
                "seconds": {"type": "string", "description": "Крок для forward/back. Типово 10 секунд."},
                "position": {"type": "string", "description": "Куди стрибнути для seek: «2:30» або секунди."},
                "rate": {"type": "string", "description": "Швидкість для speed: 0.5…2."},
            },
            "required": ["action"],
        },
    },
    {
        "name": "video_status",
        "description": (
            "Що зараз грає на екрані: назва, позиція, скільки лишилось, швидкість, "
            "скільки рекламних шматків пропущено. Викликай ПЕРЕД тим, як казати щось "
            "про поточне відео — інакше вигадаєш."
        ),
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "video_settings",
        "description": (
            "Показати або змінити адблок відео: пропуск вклеєної реклами (SponsorBlock), "
            "категорії пропуску, чи тягнути превʼю через бота замість серверів Google. "
            "Без аргументів — просто показує стан. Використовуй на «вимкни пропуск реклами», "
            "«не пропускай інтро», «що там з адблоком»."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "sponsorblock": {"type": "boolean", "description": "Пропускати вклеєну рекламу."},
                "categories": {
                    "type": "array",
                    "items": {"type": "string", "enum": CATEGORIES},
                    "description": "Що саме пропускати.",
                },
                "proxy_thumbnails": {"type": "boolean", "description": "Превʼю через бота (приватність)."},
                "notify_skips": {"type": "boolean", "description": "Показувати плашку про пропуск."},
            },
        },
    },
]


class BotOffline(RuntimeError):
    """Бекенд бота не відповів: агент мусить це почути словами."""


def _request(method: str, path: str, payload: dict | None = None) -> dict:
    url = f"{VBOT_URL}{path}"
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {"Content-Type": "application/json"} if data else {}
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
            body = resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", "replace")
        try:
            detail = json.loads(raw).get("detail")
        except ValueError:
            detail = None
        # Помилку бекенда віддаємо ЯК ТЕКСТ інструмента, а не як збій MCP:
        # «нічого не знайшлось» — це відповідь, з якою агент може працювати.
        raise BotOffline(_detail_text(detail) or f"HTTP {exc.code}") from exc
    except Exception as exc:  # noqa: BLE001 — бот вимкнений/таймаут
        raise BotOffline(f"бот не відповів ({type(exc).__name__})") from exc
    try:
        return json.loads(body) if body else {}
    except ValueError:
        return {}


def _detail_text(detail: object) -> str:
    """FastAPI віддає detail рядком або списком обʼєктів — зводимо до рядка."""
    if isinstance(detail, str):
        return detail
    if isinstance(detail, list) and detail and isinstance(detail[0], dict):
        return str(detail[0].get("msg", ""))
    return ""


def _fmt(seconds: object) -> str:
    try:
        total = int(float(seconds))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return "0:00"
    total = max(0, total)
    s, m, h = total % 60, (total // 60) % 60, total // 3600
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


# ------------------------------------------------------------------ інструменти


def _tool_play_video(args: dict) -> str:
    query = str(args.get("query", "")).strip()
    url = str(args.get("url", "")).strip()
    if not query and not url:
        return "Що показати? Дай назву відео або посилання."
    payload: dict = {"start": str(args.get("start", "")).strip()[:16]}
    if url:
        payload["id"] = url
    else:
        payload["query"] = query
    data = _request("POST", "/api/video/play", payload)
    track = data.get("track") or {}
    title = track.get("title") or "відео"
    uploader = track.get("uploader") or ""
    line = f"Показую на екрані: «{title}»"
    if uploader:
        line += f" — {uploader}"
    if track.get("duration"):
        line += f" ({_fmt(track['duration'])})"

    # Скільки вклеєної реклами пропустимо — це варто сказати одразу
    try:
        seg = _request("GET", "/api/video/segments?id=" + str(track.get("id", "")))
    except BotOffline:
        seg = {}
    if seg.get("enabled") is False:
        line += ". Пропуск вклеєної реклами зараз вимкнений."
    elif seg.get("segments"):
        line += (f". Вклеєної реклами: {len(seg['segments'])} шматків "
                 f"({_fmt(seg.get('skipped_seconds', 0))}) — плеєр пропустить сам.")
    elif seg.get("enabled"):
        line += ". Вклеєної реклами в цьому відео не знайдено."
    return line


def _tool_video_control(args: dict) -> str:
    action = str(args.get("action", "")).strip().lower()
    if not action:
        return "Яку дію? " + ", ".join(ACTIONS)
    payload = {
        "action": action,
        "seconds": str(args.get("seconds", ""))[:16],
        "position": str(args.get("position", ""))[:16],
        "rate": str(args.get("rate", ""))[:8],
    }
    data = _request("POST", "/api/video/control", payload)
    done = data.get("done") or action
    # Стан читаємо ПІСЛЯ команди: агент має знати, чи було що контролювати
    try:
        state = _request("GET", "/api/video/state")
    except BotOffline:
        state = {}
    if not state.get("video_id"):
        return (f"{done}. Але екран не повідомляв, що зараз щось грає — "
                "якщо відео не було, спочатку увімкни його через play_video.")
    return f"{done}. Зараз: «{state.get('title', '')}» на {state.get('position_human', '?')}."


def _tool_video_status(_args: dict) -> str:
    state = _request("GET", "/api/video/state")
    if not state.get("video_id"):
        return state.get("note") or "Зараз на екрані відео не грає."
    parts = [
        ("грає" if state.get("playing") else "на паузі") + f": «{state.get('title', '')}»",
        f"{state.get('position_human', '?')} з {state.get('duration_human', '?')}",
        f"лишилось {state.get('left_human', '?')}",
    ]
    rate = state.get("rate", 1)
    if rate and float(rate) != 1.0:
        parts.append(f"швидкість {rate}×")
    if state.get("muted"):
        parts.append("без звуку")
    if state.get("skipped_count"):
        parts.append(f"пропущено рекламу: {int(state['skipped_count'])} шматків "
                     f"({_fmt(state.get('skipped_seconds', 0))})")
    return "; ".join(parts) + "."


def _tool_video_settings(args: dict) -> str:
    patch = {k: args[k] for k in ("sponsorblock", "categories", "proxy_thumbnails", "notify_skips")
             if k in args and args[k] is not None}
    data = (_request("POST", "/api/video/settings", patch) if patch
            else _request("GET", "/api/video/settings"))
    settings = data.get("settings") or {}
    catalog = data.get("categories") or {}
    skipping = [catalog.get(c, c) for c in settings.get("categories", [])]
    lines = [
        "Пропуск вклеєної реклами: " + ("увімкнено" if settings.get("sponsorblock") else "вимкнено"),
        "Пропускаємо: " + (", ".join(skipping) if skipping else "нічого"),
        "Превʼю через бота: " + ("так" if settings.get("proxy_thumbnails") else "ні (напряму з Google)"),
        "Плашка про пропуск: " + ("так" if settings.get("notify_skips") else "ні"),
        "Рекламу, яку вставляє сам YouTube, ми не бачимо взагалі — відео йде "
        "потоком через бота, без їхнього плеєра.",
    ]
    return "\n".join(lines)


HANDLERS = {
    "play_video": _tool_play_video,
    "video_control": _tool_video_control,
    "video_status": _tool_video_status,
    "video_settings": _tool_video_settings,
}


# ------------------------------------------------------------------ протокол


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

    # Нотифікації (без id) — нічого не відповідаємо
    if req_id is None and method and method.startswith("notifications/"):
        return

    if method == "initialize":
        _result(req_id, {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "klod-bot-youtube", "version": "1.0.0"},
        })
    elif method == "ping":
        _result(req_id, {})
    elif method == "tools/list":
        _result(req_id, {"tools": TOOLS})
    elif method == "tools/call":
        params = msg.get("params") or {}
        name = params.get("name")
        args = params.get("arguments") or {}
        handler = HANDLERS.get(name)
        if handler is None:
            _error(req_id, -32602, f"Невідомий інструмент: {name}")
            return
        try:
            text = handler(args if isinstance(args, dict) else {})
            is_error = False
        except BotOffline as exc:
            # isError=true, але з людським текстом: агент мусить зрозуміти, що
            # екран недосяжний, і сказати це, а не робити вигляд, що показав
            text = f"Екран бота недосяжний: {exc}"
            is_error = True
        _result(req_id, {"content": [{"type": "text", "text": text}], "isError": is_error})
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
