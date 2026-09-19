"""
«Клод Бот» — керування ВІДЕО на екрані пристрою (застосунок YouTube).

Навіщо окремий модуль, а не гілка в music.py: музика — це Now Playing, бар
знизу, звук без картинки, який живе далі після закриття застосунку. Відео —
це плеєр ВСЕРЕДИНІ застосунку youtube, з картинкою, перемоткою і пропуском
рекламних сегментів. Різні життєві цикли, різні джерела ([`/api/music/video`]
проти `/api/music/stream`) — і зливати їх в один обробник означало б зробити
крихкими обидва.

Як команда доходить до плеєра:

    бот («перемотай на дві хвилини»)
      → тул video_control                       (tools/video_tools.py)
        → events.publish_video({action, ...})    SSE
          → screen.js: відкриває застосунок youtube, якщо він закритий,
            і шле команду в iframe через postMessage
            → застосунок робить це з <video> і постить новий стан назад
              (POST /api/video/state) — щоб бот наступного разу знав,
              де саме зупинилися

Зворотний канал важливий: без нього на «а де ми зупинились?» бот міг би лише
вигадати. Стан живе в памʼяті процесу і має TTL — екран вимкнули, і за
пів хвилини бот уже чесно каже «нічого не грає», замість описувати минуле.

Налаштування (SponsorBlock, проксі прев'ю) лежать у runtime/video-settings.json:
їх бачить і застосунок, і бот, тож перемикач на екрані і фраза «вимкни
пропуск реклами» роблять ОДНЕ І ТЕ САМЕ.
"""

from __future__ import annotations

import json
import logging
import re
import time
from pathlib import Path
from threading import Lock
from typing import Any

import app_config
import sponsorblock

log = logging.getLogger("virtual_bot.video")

# Пакет застосунку, який показує відео. Тули самі його встановлюють, якщо
# людина ще не заходила в магазин — це наш пакет із репозиторію, не чужий код.
APP_PKG = "youtube"

# Стан старіший за це вважаємо мертвим: екран міг заснути, згаснути або
# застосунок закрили — і «грає» перетворилося б на брехню.
STATE_TTL_S = 40.0

# Крок перемотки за замовчуванням — СИМЕТРИЧНИЙ, і в обидві сторони той
# самий, що на кнопках плеєра (SEEK_STEP_S у пакеті youtube). Асиметрія
# («назад коротше, бо перечути фразу; вперед довше, бо проскочити нудне»)
# виглядає розумно на папері, але на екрані дає пару однакових кнопок, які
# роблять різне — і людина не знає, куди скільки стрибне. Скільки завгодно
# бот усе одно вміє: «перемотай на хвилину» → seconds=60.
DEFAULT_STEP_S = 10
MAX_SEEK_S = 86_400

# Швидкості, які має сам застосунок (RATES у index.html) — тримаємо контракт
# в одному місці, щоб бот не просив 3×, чого плеєр не вміє показати кнопкою.
ALLOWED_RATES = (0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0)

ACTIONS: dict[str, str] = {
    "pause": "пауза",
    "resume": "далі",
    "stop": "зупинено",
    "forward": "вперед",
    "back": "назад",
    "seek": "перемотка",
    "restart": "з початку",
    "end": "у кінець",
    "speed": "швидкість",
    "mute": "без звуку",
    "unmute": "зі звуком",
}

# Синоніми: мозок цілком може сказати «стоп» або "play" замість канонічного
_ALIASES: dict[str, str] = {
    "play": "resume", "продовжити": "resume", "далі": "resume", "унпауза": "resume",
    "start": "resume", "грай": "resume", "включи": "resume",
    "пауза": "pause", "стоп кадр": "pause", "зупини на мить": "pause",
    "стоп": "stop", "вимкни": "stop", "закрий": "stop", "close": "stop",
    "вперед": "forward", "далі на": "forward", "skip": "forward", "ff": "forward",
    "назад": "back", "rewind": "back", "повтори": "back",
    "перемотай": "seek", "goto": "seek", "position": "seek",
    "з початку": "restart", "спочатку": "restart", "beginning": "restart",
    "кінець": "end", "в кінець": "end", "finish": "end", "до кінця": "end",
    "швидкість": "speed", "rate": "speed", "швидше": "speed",
    "тихо": "mute", "приглуши": "mute", "звук вимкни": "mute",
    "звук": "unmute", "поверни звук": "unmute",
}


class VideoError(Exception):
    """Керована помилка: текст іде людині/боту як є."""


def resolve_action(name: object) -> str | None:
    key = " ".join(str(name or "").split()).lower()
    if not key:
        return None
    if key in ACTIONS:
        return key
    return _ALIASES.get(key)


# ---------------------------------------------------------------- налаштування

_SETTINGS_LOCK = Lock()

DEFAULTS: dict[str, Any] = {
    # Пропуск вклеєної реклами. Увімкнено за замовчуванням: людина ставила
    # бота на стіл, щоб дивитися відео, а не спонсорські вставки.
    "sponsorblock": True,
    # Що саме пропускати. Заставки/титри/«лайк і підписка» НЕ вмикаємо
    # типово — люди часто хочуть бачити інтро каналу, а «пропустив початок»
    # виглядає як поламаний плеєр.
    "categories": ["sponsor", "selfpromo", "interaction", "music_offtopic"],
    # Прев'ю через бота, а не напряму з i.ytimg.com: жодного запиту до Google
    # з пристрою (і сітка не розсипається, коли мережі до Google немає).
    "proxy_thumbnails": True,
    # Плашка «⏭ пропущено рекламу» — щоб пропуск не читався як збій плеєра.
    "notify_skips": True,
}


def _settings_path() -> Path:
    # runtime/ — теку не комітять (див. .gitignore), і це правильне місце:
    # налаштування пристрою, а не джерело проєкту.
    return Path(app_config.BASE_DIR) / "runtime" / "video-settings.json"


def _sanitize(raw: object) -> dict[str, Any]:
    """Будь-який вхід → валідні налаштування. Ніколи не кидає."""
    out = dict(DEFAULTS)
    out["categories"] = list(DEFAULTS["categories"])
    if not isinstance(raw, dict):
        return out
    for key in ("sponsorblock", "proxy_thumbnails", "notify_skips"):
        if key in raw:
            out[key] = bool(raw[key])
    if "categories" in raw:
        cleaned = sponsorblock.clean_categories(raw["categories"])
        # Порожній список при увімкненому пропуску — це «нічого не пропускати»,
        # тобто той самий вимкнений SponsorBlock, тільки непомітно. Не даємо
        # прийти в такий стан молча: пропуск вимикаємо явно.
        out["categories"] = cleaned
        if not cleaned:
            out["sponsorblock"] = False
    return out


def load_settings() -> dict[str, Any]:
    with _SETTINGS_LOCK:
        try:
            raw = json.loads(_settings_path().read_text("utf-8"))
        except (OSError, ValueError):
            return _sanitize(None)
        return _sanitize(raw)


def save_settings(patch: object) -> dict[str, Any]:
    """Часткове оновлення: приходить лише те, що змінили на екрані."""
    if not isinstance(patch, dict):
        raise VideoError("Налаштування мусять бути обʼєктом")
    with _SETTINGS_LOCK:
        try:
            current = _sanitize(json.loads(_settings_path().read_text("utf-8")))
        except (OSError, ValueError):
            current = _sanitize(None)
        merged = dict(current)
        merged.update({k: v for k, v in patch.items() if k in DEFAULTS})
        clean = _sanitize(merged)
        path = _settings_path()
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            # Пишемо через тимчасовий файл: обрив живлення Pi посеред записи
            # інакше лишив би обрізаний JSON, і налаштування злетіли б до
            # дефолтів без жодного слова.
            tmp = path.with_suffix(".json.tmp")
            tmp.write_text(json.dumps(clean, ensure_ascii=False, indent=2), "utf-8")
            tmp.replace(path)
        except OSError as exc:
            log.warning("Не вдалося зберегти налаштування відео: %s", exc)
            raise VideoError("Не вдалося зберегти налаштування") from exc
        log.info("⚙ Відео: sponsorblock=%s, категорій=%d",
                 clean["sponsorblock"], len(clean["categories"]))
        return clean


def active_categories() -> list[str]:
    """Що пропускати ЗАРАЗ (вимкнений SponsorBlock = нічого)."""
    settings = load_settings()
    if not settings["sponsorblock"]:
        return []
    return list(settings["categories"])


# ------------------------------------------------------------------- стан плеєра

_STATE_LOCK = Lock()
_state: dict[str, Any] = {}
_state_ts: float = 0.0


def update_state(payload: dict[str, Any]) -> dict[str, Any]:
    """Застосунок повідомляє, що в нього відбувається. Тільки відомі поля."""
    global _state, _state_ts
    clean: dict[str, Any] = {
        "video_id": str(payload.get("video_id", ""))[:16],
        "title": str(payload.get("title", ""))[:300],
        "position": _f(payload.get("position"), 0.0, MAX_SEEK_S),
        "duration": _f(payload.get("duration"), 0.0, MAX_SEEK_S),
        "paused": bool(payload.get("paused", False)),
        "muted": bool(payload.get("muted", False)),
        "rate": _f(payload.get("rate"), 0.25, 4.0) or 1.0,
        "skipped_count": int(_f(payload.get("skipped_count"), 0, 999) or 0),
        "skipped_seconds": _f(payload.get("skipped_seconds"), 0.0, MAX_SEEK_S),
        "segments": int(_f(payload.get("segments"), 0, 999) or 0),
    }
    with _STATE_LOCK:
        _state = clean
        _state_ts = time.monotonic()
    return clean


def clear_state() -> None:
    """Плеєр закрився — стан більше не описує реальність."""
    global _state, _state_ts
    with _STATE_LOCK:
        _state = {}
        _state_ts = 0.0


def state() -> dict[str, Any]:
    """Останній відомий стан плеєра + чи він ще свіжий."""
    with _STATE_LOCK:
        snapshot = dict(_state)
        ts = _state_ts
    if not snapshot or (time.monotonic() - ts) > STATE_TTL_S:
        return {"playing": False, "note": "Зараз на екрані відео не грає."}
    age = round(time.monotonic() - ts, 1)
    snapshot["playing"] = not snapshot.get("paused", False)
    snapshot["age_sec"] = age
    snapshot["position_human"] = human_time(snapshot.get("position", 0))
    snapshot["duration_human"] = human_time(snapshot.get("duration", 0))
    left = max(0.0, (snapshot.get("duration") or 0) - (snapshot.get("position") or 0))
    snapshot["left_human"] = human_time(left)
    return snapshot


def _f(value: object, low: float, high: float) -> float:
    try:
        num = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return low
    if num != num:  # NaN
        return low
    return max(low, min(high, num))


def human_time(seconds: object) -> str:
    """0:07 / 1:23:45 — годинник зʼявляється лише коли він потрібен."""
    total = int(max(0.0, _f(seconds, 0.0, MAX_SEEK_S)))
    s, m, h = total % 60, (total // 60) % 60, total // 3600
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


_CLOCK_RE = re.compile(r"^(?:(\d{1,2}):)?(\d{1,3}):(\d{1,2})$")


def parse_position(value: object) -> float | None:
    """«2:30», «1:05:00», «90», 90 → секунди. None — не розпізнали."""
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        num = float(value)
        return num if 0 <= num <= MAX_SEEK_S else None
    text = str(value or "").strip()
    if not text:
        return None
    match = _CLOCK_RE.match(text)
    if match:
        hours = int(match.group(1) or 0)
        minutes = int(match.group(2))
        secs = int(match.group(3))
        if secs > 59:
            return None
        total = hours * 3600 + minutes * 60 + secs
        return float(total) if total <= MAX_SEEK_S else None
    # «90», «90с», «90 сек» — теж зрозуміла позиція
    plain = re.match(r"^(\d{1,6})\s*(?:s|sec|с|сек|секунд)?$", text, re.IGNORECASE)
    if plain:
        total = int(plain.group(1))
        return float(total) if total <= MAX_SEEK_S else None
    return None


def build_command(action: str, *, seconds: object = None, position: object = None,
                  rate: object = None) -> dict[str, Any]:
    """Валідована команда для SSE. VideoError — якщо аргумент безглуздий."""
    resolved = resolve_action(action)
    if resolved is None:
        raise VideoError(
            "Невідома дія. Можна: " + ", ".join(sorted(ACTIONS)),
        )
    command: dict[str, Any] = {"action": resolved}

    if resolved in ("forward", "back"):
        step = parse_position(seconds) if seconds not in (None, "") else float(DEFAULT_STEP_S)
        if step is None or step <= 0:
            raise VideoError("Скільки секунд перемотати? Напр. 30 або «1:30».")
        command["seconds"] = round(min(step, MAX_SEEK_S), 2)
    elif resolved == "seek":
        target = parse_position(position if position not in (None, "") else seconds)
        if target is None:
            raise VideoError("Куди перемотати? Напр. «2:30» або 150.")
        command["position"] = round(target, 2)
    elif resolved == "speed":
        value = _f(rate if rate not in (None, "") else seconds, 0.0, 4.0)
        if not value:
            raise VideoError("Яка швидкість? Напр. 1.5.")
        # Найближча з тих, що плеєр справді має
        command["rate"] = min(ALLOWED_RATES, key=lambda r: abs(r - value))
    return command


def describe(command: dict[str, Any]) -> str:
    """Людський опис виконаної команди — його бот і промовляє."""
    action = command.get("action", "")
    if action == "forward":
        return f"Вперед на {int(command['seconds'])} с"
    if action == "back":
        return f"Назад на {int(command['seconds'])} с"
    if action == "seek":
        return f"Перемотано на {human_time(command['position'])}"
    if action == "speed":
        return f"Швидкість {command['rate']}×"
    return ACTIONS.get(action, action).capitalize()


async def segments_for(video_id: str) -> dict[str, Any]:
    """Сегменти для пропуску з урахуванням налаштувань пристрою."""
    categories = active_categories()
    if not categories:
        return {"enabled": False, "segments": [], "skipped_seconds": 0.0}
    try:
        found = await sponsorblock.segments(video_id, categories)
    except Exception as exc:  # noqa: BLE001 — база пропусків не критична
        # sponsorblock.segments ловить свої збої сама, але «не критична» мусить
        # триматися на кожному рівні: інакше один виняток нижче перетворює
        # показ відео на 502, замість показу без пропусків.
        log.info("Сегменти для %s не отримано (%s) — граємо без пропусків",
                 video_id, type(exc).__name__)
        found = []
    return {
        "enabled": True,
        "segments": found,
        "skipped_seconds": sponsorblock.total_skipped(found),
    }
