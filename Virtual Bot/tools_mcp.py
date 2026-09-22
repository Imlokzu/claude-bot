#!/usr/bin/env python3
"""
«Клод Бот» — tools-MCP: stdio-MCP-сервер, що віддає OpenClaw-агенту тули
панелі (пошук в інтернеті, погода, курс валют, факти).

Навіщо: tools/registry.py бачить лише локальний мозок Virtual Bot. Коли
активний мозок — OpenClaw, він ходить власним набором інструментів, тож
без цього містка агент чесно каже «у мене немає веб-пошуку». Сервер нічого
не рахує сам: він лише проксює виклики на /api/tools/call, тому в панелі
заразом засвічуються звичні картки інструментів.

Протокол: MCP поверх stdio = JSON-RPC 2.0, роздільник — новий рядок.

Реєстрація в OpenClaw:
  openclaw mcp add tools --command python3 --arg /абс/шлях/tools_mcp.py \
    --env VBOT_URL=http://127.0.0.1:8100
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

VBOT_URL = os.environ.get("VBOT_URL", "http://127.0.0.1:8100").rstrip("/")
VBOT_SESSION = os.environ.get("VBOT_SESSION", "")
PROTOCOL_VERSION = "2024-11-05"

TOOLS = [
    {
        "name": "web_search",
        "description": (
            "Знайти актуальну інформацію в інтернеті (DuckDuckGo). Використовуй ЗАВЖДИ, "
            "коли питання про новини, свіжі події, ціни, релізи чи щось, чого ти можеш не знати — "
            "краще пошукати, ніж вигадати."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Пошуковий запит."},
                "count": {"type": "integer", "description": "Скільки результатів (1-5), типово 3."},
            },
            "required": ["query"],
        },
    },
    {
        "name": "image_search",
        "description": (
            "Знайти картинки в інтернеті. Повертає прямі https-посилання. "
            "ОБОВʼЯЗКОВО вставляй знайдене у відповідь як ![підпис](посилання) — інакше користувач побачить лише текст. У квадратних дужках пиши КОРОТКИЙ ЗМІСТОВНИЙ підпис саме цієї картинки (напр. «Porsche 911 Carrera», «краб-привид на піску»), а не загальний запит: коли картинок кілька, підпис — єдине, з чого видно, що на кожній."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Що показати."},
                "count": {"type": "integer", "description": "Скільки картинок (1-6), типово 3."},
            },
            "required": ["query"],
        },
    },
    {
        "name": "facts",
        "description": "Коротка довідка з Вікіпедії про людину, місце, поняття.",
        "inputSchema": {
            "type": "object",
            "properties": {"query": {"type": "string", "description": "Тема, напр. 'Краби'."}},
            "required": ["query"],
        },
    },
    {
        "name": "weather",
        "description": "Поточна погода і прогноз на 5 днів для міста.",
        "inputSchema": {
            "type": "object",
            "properties": {"city": {"type": "string", "description": "Напр. Київ, Львів, Берлін."}},
            "required": ["city"],
        },
    },
    {
        "name": "currency",
        "description": "Актуальний курс валют.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "base": {"type": "string", "description": "Базова валюта, напр. USD."},
                "target": {"type": "string", "description": "Цільова, типово UAH."},
            },
            "required": ["base"],
        },
    },
    {
        "name": "ask_question",
        "description": (
            "Поставити користувачу питання КАРТКОЮ З КНОПКАМИ замість звичайного тексту. "
            "Використовуй ЗАВЖДИ, коли пропонуєш вибір або перепитуєш уточнення — "
            "натиснути кнопку швидше, ніж друкувати. Відповідь прийде окремим повідомленням."
        ),
        "inputSchema": {
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
    {
        "name": "todo_list",
        "description": (
            "Показати список справ інтерактивним чеклістом — коли плануєш роботу або "
            "перелічуєш кроки. Користувач сам ставить галочки."
        ),
        "inputSchema": {
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
    {
        "name": "show_choice",
        "description": (
            "Показати кілька варіантів картками з описом (напр. варіанти дизайну чи підходу). "
            "Користувач обирає кліком."
        ),
        "inputSchema": {
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
]

TOOLS.append(
    {
        "name": "share_site",
        "description": (
            "Опублікувати сайт із робочої теки в інтернеті через Cloudflare Tunnel. "
            "Повертає публічне посилання https://<slug>.waveio.me. Використовуй, коли "
            "користувач просить показати чи поділитись сайтом, який ти зробив."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Шлях у workspace, напр. 'games/mario'."},
                "slug": {"type": "string", "description": "Коротке ім'я для посилання (a-z, 0-9, дефіс)."},
            },
            "required": ["path", "slug"],
        },
    }
)
TOOLS.append(
    {
        "name": "unshare_site",
        "description": "Зняти сайт із публікації — посилання перестає працювати.",
        "inputSchema": {
            "type": "object",
            "properties": {"slug": {"type": "string", "description": "Slug публікації."}},
            "required": ["slug"],
        },
    }
)
TOOLS.append(
    {
        "name": "list_shared_sites",
        "description": "Показати всі сайти, що зараз опубліковані через тунель.",
        "inputSchema": {"type": "object", "properties": {}},
    }
)

# Media. These live in tools/music_tools.py and the local registry already had
# them, but the bridge never declared them — so through OpenClaw the bot
# honestly answered "I have no video tool" while the capability sat unused.
# Descriptions are kept in sync with tools/music_tools.py SCHEMAS.
TOOLS.append(
    {
        "name": "listen_to_video",
        "description": (
            "ПРОЧИТАТИ зміст YouTube-відео через субтитри (безкоштовний "
            "транскрайб) і ввімкнути його звук на екрані пристрою. "
            "Використовуй, коли користувач кидає посилання на відео або "
            "просить «подивись/послухай це відео»."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "Посилання на відео: https://youtube.com/watch?v=… або https://youtu.be/…",
                },
                "lang": {
                    "type": "string",
                    "description": "Бажана мова субтитрів (uk, en…). Типово uk.",
                },
                "part": {
                    "type": "integer",
                    "description": (
                        "Яку частину транскрайбу читати. Довге відео не влазить в "
                        "один запит: почни з 1, а якщо у відповіді has_more=true і "
                        "треба знати більше — виклич ще раз із part=2, 3 і далі."
                    ),
                },
            },
            "required": ["url"],
        },
    }
)
TOOLS.append(
    {
        "name": "play_music",
        "description": (
            "Увімкнути музику на екрані пристрою: шукає трек на YouTube за "
            "назвою або виконавцем і починає відтворення."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Назва пісні або виконавець."},
            },
            "required": ["query"],
        },
    }
)
TOOLS.append(
    {
        "name": "stop_music",
        "description": "Зупинити відтворення на екрані пристрою.",
        "inputSchema": {"type": "object", "properties": {}},
    }
)

# Відео з картинкою на екрані пристрою (tools/video_tools.py). Окреме від
# listen_to_video: те читає субтитри, а це показує ролик. Бот справедливо
# скаржився, що «інструмент відтворення недоступний» — міст його не оголошував.
TOOLS.append(
    {
        "name": "play_video",
        "description": (
            "Показати ВІДЕО з YouTube на екрані пристрою — з КАРТИНКОЮ, на весь "
            "екран, з автоматичним пропуском вклеєної реклами. Використовуй, коли "
            "просять «покажи відео», «увімкни ролик», «постав на екран …», "
            "«знайди відео про …» або кидають посилання й хочуть ДИВИТИСЬ. "
            "Якщо просять саме МУЗИКУ/звук у фоні — бери play_music."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Що шукати, напр. «огляд Raspberry Pi 5» або назва кліпу.",
                },
                "url": {
                    "type": "string",
                    "description": "Пряме посилання, якщо дали його: watch?v=… або youtu.be/…",
                },
                "start": {
                    "type": "string",
                    "description": "З якої секунди/хвилини почати, напр. «2:30» або «150». Не обовʼязково.",
                },
            },
        },
    }
)
TOOLS.append(
    {
        "name": "video_control",
        "description": (
            "Керувати відео, яке ВЖЕ грає на екрані: пауза, продовжити, зупинити, "
            "перемотати вперед/назад, стрибнути на час, у початок, у кінець, "
            "змінити швидкість, приглушити. Використовуй на «стоп», «пауза», "
            "«перемотай вперед», «на 5 хвилині», «в кінець», «швидше»."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["pause", "resume", "stop", "forward", "back", "seek",
                             "restart", "end", "speed", "mute", "unmute"],
                    "description": (
                        "pause — пауза; resume — далі; stop — зупинити й закрити; "
                        "forward/back — перемотати на seconds; seek — на position; "
                        "restart — з початку; end — у кінець; speed — швидкість rate; "
                        "mute/unmute — звук."
                    ),
                },
                "seconds": {
                    "type": "string",
                    "description": "На скільки перемотати для forward/back. Типово 10 секунд.",
                },
                "position": {
                    "type": "string",
                    "description": "Куди стрибнути для seek: «2:30», «1:05:00» або секунди.",
                },
                "rate": {
                    "type": "string",
                    "description": "Швидкість для speed: 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2.",
                },
            },
            "required": ["action"],
        },
    }
)
TOOLS.append(
    {
        "name": "video_status",
        "description": (
            "Дізнатися, що зараз грає на екрані: назва, позиція, скільки лишилось, "
            "швидкість, скільки реклами пропущено. Викликай ПЕРЕД тим, як казати "
            "щось про поточне відео — інакше вигадаєш."
        ),
        "inputSchema": {"type": "object", "properties": {}},
    }
)
TOOLS.append(
    {
        "name": "video_settings",
        "description": (
            "Показати або змінити налаштування відео: пропуск вклеєної реклами "
            "(SponsorBlock), які категорії пропускати, чи тягнути прев'ю через "
            "бота замість серверів Google. Без аргументів — просто показує стан."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "skip_sponsors": {"type": "boolean", "description": "Пропускати вклеєну рекламу."},
                "categories": {"type": "string", "description": "Категорії через кому."},
                "proxy_thumbs": {"type": "boolean", "description": "Тягнути прев'ю через бота."},
            },
        },
    }
)

_TOOL_NAMES = {t["name"] for t in TOOLS}


# Fetching subtitles for a long video is a download, not a lookup: the default
# 30s budget cut it off and the agent saw a timeout instead of the transcript.
SLOW_TOOLS = {"listen_to_video": 120, "play_music": 60}
DEFAULT_TIMEOUT_S = 30


def _call_panel(name: str, args: dict) -> dict:
    """POST /api/tools/call; помилка не валить MCP — повертаємо {'error': …}."""
    body = json.dumps({"name": name, "args": args, "session_id": VBOT_SESSION}).encode("utf-8")
    req = urllib.request.Request(
        f"{VBOT_URL}/api/tools/call",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=SLOW_TOOLS.get(name, DEFAULT_TIMEOUT_S)) as resp:
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
            "serverInfo": {"name": "klod-bot-tools", "version": "1.0.0"},
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
        payload = _call_panel(name, params.get("arguments") or {})
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
