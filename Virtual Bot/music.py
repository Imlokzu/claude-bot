"""
«Клод Бот» — музика для екрана (Now Playing).

Джерела:
- youtube — НЕофіційний API через yt-dlp: пошук (`ytsearch`) і витяг
  прямої аудіо-ссилки (bestaudio). Стрімимо через бекенд із підтримкою
  Range — саме тому перемотка в браузері працює як у справжньому плеєрі.
- radio   — прямі публічні потоки (SomaFM, Radio Paradise). Це ЖИВІ стріми:
  перемотки не існує за визначенням, екран її й не показує.

Транскрайб відео — youtube-transcript-api (безкоштовно, без ключа, працює
з автоматичними субтитрами). Ним бот «слухає» відео: користувач кидає
посилання, бот читає текст і обговорює зміст.

Залежності опціональні: без yt-dlp / youtube-transcript-api модуль чесно
повідомляє «недоступно» через availability(), а не падає.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from typing import Any

import httpx

import app_config

log = logging.getLogger("virtual_bot.music")

# Різні джерела примхливі до User-Agent:
# - Invidious: «нічийні» UA (ClaudeBot) — 403, браузерні — JS-челендж,
#   тому йдемо з дефолтним python-httpx;
# - icecast-радіо (SomaFM): голий curl/python UA — обрив зʼєднання,
#   тому там потрібен звичайний браузерний UA (див. BROWSER_UA).
BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

# ---------------------------------------------------------------- доступність

try:
    import yt_dlp  # type: ignore
    _YTDLP_ERROR = ""
except Exception as exc:  # noqa: BLE001 — будь-який збій імпорту = «немає»
    yt_dlp = None
    _YTDLP_ERROR = f"{type(exc).__name__}"

try:
    from youtube_transcript_api import YouTubeTranscriptApi  # type: ignore
    _TRANSCRIPT_ERROR = ""
except Exception as exc:  # noqa: BLE001
    YouTubeTranscriptApi = None
    _TRANSCRIPT_ERROR = f"{type(exc).__name__}"


def availability() -> dict[str, Any]:
    """Що зараз працює: екран показує це чесно, а не мовчки ламається."""
    return {
        "youtube": yt_dlp is not None,
        "transcript": YouTubeTranscriptApi is not None,
        "errors": {"youtube": _YTDLP_ERROR, "transcript": _TRANSCRIPT_ERROR},
    }


# ---------------------------------------------------------------- id відео

_VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")

# Патерн на youtu.be/ID, /watch?v=ID, /shorts/ID, /embed/ID, /live/ID
_URL_ID_RE = re.compile(
    r"(?:youtu\.be/|v=|/shorts/|/embed/|/live/)([A-Za-z0-9_-]{11})"
)


def parse_video_id(value: str) -> str | None:
    """Посилання або сам id → 11-символьний id YouTube, або None."""
    text = (value or "").strip()
    if not text:
        return None
    if _VIDEO_ID_RE.match(text):
        return text
    match = _URL_ID_RE.search(text)
    return match.group(1) if match else None


# ---------------------------------------------------------------- радіо

# Прямі mp3-потоки — без ключів і реєстрацій. Це живе мовлення: перемотати
# не можна, тож екран ховає повзунок для них.
RADIO_STATIONS: list[dict[str, Any]] = [
    {"id": "groovesalad", "title": "SomaFM — Groove Salad", "genre": "chillout / downtempo", "url": "https://ice1.somafm.com/groovesalad-128-mp3"},
    {"id": "lush", "title": "SomaFM — Lush", "genre": "vocal chill", "url": "https://ice1.somafm.com/lush-128-mp3"},
    {"id": "defcon", "title": "SomaFM — DEF CON Radio", "genre": "для кодингу", "url": "https://ice1.somafm.com/defcon-128-mp3"},
    {"id": "dronezone", "title": "SomaFM — Drone Zone", "genre": "ambient", "url": "https://ice1.somafm.com/dronezone-128-mp3"},
    {"id": "beatblender", "title": "SomaFM — Beat Blender", "genre": "deep house", "url": "https://ice1.somafm.com/beatblender-128-mp3"},
    {"id": "fluid", "title": "SomaFM — Fluid", "genre": "instrumental hip hop", "url": "https://ice1.somafm.com/fluid-128-mp3"},
    {"id": "radioparadise", "title": "Radio Paradise — Main Mix", "genre": "eclectic rock", "url": "https://stream.radioparadise.com/mp3-128"},
]

_RADIO_BY_ID = {st["id"]: st for st in RADIO_STATIONS}


def radio_station(station_id: str) -> dict[str, Any] | None:
    return _RADIO_BY_ID.get((station_id or "").strip())


def radio_catalog() -> list[dict[str, Any]]:
    return [dict(st) for st in RADIO_STATIONS]


# ---------------------------------------------------------------- yt-dlp: пошук і стрім

_SEARCH_CACHE: dict[str, tuple[float, list[dict[str, Any]]]] = {}
_SEARCH_TTL_S = 600          # 10 хвилин: результати пошуку не псуються
_URL_CACHE: dict[str, tuple[float, str]] = {}
# Прямі ссилки googlevideo живуть ~6 год; 30 хв — з запасом, щоб не гнати
# повний extract_info на кожен старт/перемотку.
_URL_TTL_S = 1800

_YDL_BASE: dict[str, Any] = {
    "quiet": True,
    "no_warnings": True,
    "noprogress": True,
    "noplaylist": True,
    "socket_timeout": 15,
    # Без зовнішніх даунлоадерів: потрібен лиш прямий https-потік
}


def _search_sync(query: str, limit: int) -> list[dict[str, Any]]:
    """Блокуючий пошук yt-dlp — викликати only через asyncio.to_thread."""
    opts = dict(_YDL_BASE)
    opts["extract_flat"] = "in_playlist"   # метадані без витягу стрімів — швидко
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(f"ytsearch{limit}:{query}", download=False)
    entries = (info or {}).get("entries") or []
    out: list[dict[str, Any]] = []
    for entry in entries:
        if not entry or not entry.get("id"):
            continue
        out.append({
            "id": entry["id"],
            "title": entry.get("title") or "Без назви",
            "uploader": entry.get("uploader") or entry.get("channel") or "",
            "duration": int(entry["duration"]) if entry.get("duration") else 0,
            "provider": "youtube",
        })
    return out


async def search(query: str, limit: int = 5) -> list[dict[str, Any]]:
    """Пошук треків на YouTube. Повертає [] якщо yt-dlp немає/помилка мережі."""
    if yt_dlp is None:
        return []
    query = (query or "").strip()[:200]
    if not query:
        return []
    limit = max(1, min(8, int(limit)))
    key = f"{query}|{limit}"
    cached = _SEARCH_CACHE.get(key)
    if cached and time.monotonic() - cached[0] < _SEARCH_TTL_S:
        return cached[1]
    try:
        tracks = await asyncio.to_thread(_search_sync, query, limit)
    except Exception as exc:  # noqa: BLE001 — мережа/юнікод/любий збій yt-dlp
        log.warning("Пошук yt-dlp не вдався: %s: %s", type(exc).__name__, exc)
        return []
    _SEARCH_CACHE[key] = (time.monotonic(), tracks)
    return tracks


def _pick_audio_url(info: dict[str, Any]) -> str:
    """Витягує пряму ссилку найкращого аудіо з повного info yt-dlp."""
    fmts = info.get("formats") or []
    best, best_abr = None, -1.0
    for fmt in fmts:
        if not fmt.get("url"):
            continue
        audio = fmt.get("acodec") not in (None, "none")
        video = fmt.get("vcodec") not in (None, "none")
        if not audio or video:
            continue
        abr = float(fmt.get("abr") or 0)
        if abr > best_abr:
            best, best_abr = fmt, abr
    if best:
        return best["url"]
    # fallback: запитували з format bestaudio — yt-dlp кладе готову ссилку в info
    url = info.get("url")
    if not url:
        raise RuntimeError("у відповіді немає аудіо-формату")
    return url


def _extract_sync(video_id: str) -> str:
    opts = dict(_YDL_BASE)
    opts["format"] = "bestaudio/best"
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
    return _pick_audio_url(info or {})


# ---------------------------------------------------------------- Invidious
#
# Прямі ссилки googlevideo (yt-dlp) прив'язані до IP і з 2025-го часто
# закриті PO-токен-гейтом — на частині провайдерів вони віддають 403 навіть
# yt-dlp. Тому АУДІО беремо через Invidious: `local=true` означає, що
# інстанс ПРОКСЮЄ videoplayback крізь себе — Range/перемотка працюють,
# гейт обходиться легально (це той самий неофіційний API, що й у NewPipe).
# Список інстансів — у config.yaml (music.invidious_instances).

def invidious_instances() -> list[str]:
    """Інстанси з config.yaml (music.invidious_instances); порожньо → дефолт."""
    raw = app_config.cfg("music", "invidious_instances", default=None)
    out = []
    for item in raw if isinstance(raw, list) else []:
        text = str(item).strip().rstrip("/")
        # http:// теж дозволено: власний Invidious у локальній мережі —
        # найстабільніший варіант для реального бота (див. docs/)
        if text.startswith(("https://", "http://")):
            out.append(text)
    return out or ["https://invidious.f5.si"]


# Публічні інстанси дихають нерівно (502 → 206 → 502 в межах хвилини), тож
# кандидатів має бути БАГАТО. Раз на добу питаемо офіційний список
# api.invidious.io/instances.json — інстанси, живі на цю годину.
_DISCOVER_CACHE: tuple[float, list[str]] = (0.0, [])
_DISCOVER_TTL_S = 86400


def _discovered_sync() -> list[str]:
    try:
        response = httpx.get("https://api.invidious.io/instances.json?sort_by=health", timeout=10)
        data = response.json()
    except Exception:  # noqa: BLE001 — список — це бонус, живемо й без нього
        return []
    out = []
    for entry in data if isinstance(data, list) else []:
        info = entry[1] if isinstance(entry, list) and len(entry) > 1 else None
        if isinstance(info, dict) and info.get("type") == "https":
            uri = str(info.get("uri", "")).strip().rstrip("/")
            if uri.startswith("https://"):
                out.append(uri)
    return out[:8]


async def all_invidious_instances() -> list[str]:
    """config-інстанси + автодискаверені (без дублів)."""
    global _DISCOVER_CACHE
    configured = invidious_instances()
    cached_at, cached_list = _DISCOVER_CACHE
    if time.monotonic() - cached_at < _DISCOVER_TTL_S:
        discovered = cached_list
    else:
        discovered = await asyncio.to_thread(_discovered_sync)
        _DISCOVER_CACHE = (time.monotonic(), discovered)
    seen = set(configured)
    return configured + [u for u in discovered if u not in seen]


_ITAG_AUDIO = 140   # audio/mp4 ~128k — стандартна аудіо-доріжка Invidious


def _probe_stream(url: str) -> bool:
    """Перевіряє, що ссилка віддає АУДІО з Range (1 байт), а не HTML-помилку."""
    try:
        with httpx.Client(timeout=httpx.Timeout(4.0), follow_redirects=True) as client:
            response = client.get(url, headers={"Range": "bytes=0-0"})
    except Exception:  # noqa: BLE001 — мережа/таймаут = кандидат не живий
        return False
    ctype = (response.headers.get("content-type") or "").lower()
    return response.status_code in (200, 206) and ctype.startswith("audio")


async def audio_stream_url(video_id: str) -> str:
    """Робоча аудіо-ссилка для відео: Invidious (local=true) → yt-dlp.

    Кандидати пробуються ДО 3 КОЛ: інстанси-флаппери частенько оживають на
    другій спробі. Результат валідовується одним байтом і кешується — щоб
    кожна перемотка в плеєрі не народжувала нові проби інстансів.
    """
    cached = _URL_CACHE.get(video_id)
    if cached and time.monotonic() - cached[0] < _URL_TTL_S:
        return cached[1]

    bases = await all_invidious_instances()
    yt_url = None
    if yt_dlp is not None:
        try:
            yt_url = await asyncio.to_thread(_extract_sync, video_id)
        except Exception as exc:  # noqa: BLE001 — мережа/гейт: є ще Invidious
            log.warning("yt-dlp extract %s не вдався: %s", video_id, exc)

    def candidates() -> list[str]:
        urls = [
            f"{base}/latest_version?id={video_id}&itag={_ITAG_AUDIO}&local=true"
            for base in bases
        ]
        if yt_url:
            urls.append(yt_url)
        return urls

    last_error = "немає кандидатів стріму"
    for round_no in range(3):
        # Пробуємо УСІ кандидати ПАРАЛЕЛЬНО: мертві хости тягнуть таймаут,
        # і послідовний обхід розтягував би відповідь на хвилини
        urls = candidates()
        probes = await asyncio.gather(*(asyncio.to_thread(_probe_stream, u) for u in urls))
        for url, ok in zip(urls, probes):
            if ok:
                _URL_CACHE[video_id] = (time.monotonic(), url)
                return url
        last_error = urls[-1].split("/")[2] if urls else last_error
        if round_no < 2:
            await asyncio.sleep(1.5)
    raise RuntimeError(f"жодне джерело аудіо не відповіло (останнє: {last_error})")


async def open_audio_stream(video_id: str, range_header: str | None, attempts: int = 3):
    """Відкриває аудіо-потік з ретраями.

    Публічні інстанси флапають: проба (1 байт) зелена, а наступний запит —
    уже 502. Тому спроба невдачі інвалідує кеш, і ссилка шукається заново
    (в межах attempts), поки якась не протримається хоча б до відкриття.
    """
    last_exc = None
    for attempt in range(attempts):
        url = await audio_stream_url(video_id)
        try:
            status, headers, body = await open_stream(url, range_header)
        except Exception as exc:  # noqa: BLE001 — флап інстансу: пробуємо інший
            last_exc = exc
            log.warning("Стрім %s (спроба %d) упав: %s", video_id, attempt + 1, exc)
            _URL_CACHE.pop(video_id, None)
            await asyncio.sleep(1.0)
            continue
        if status < 500:
            return status, headers, body
        # 5xx від інстансу: закриваємо і ретраїмо з новою ссилкою
        await body.aclose()
        last_exc = RuntimeError(f"інстанс віддав {status}")
        log.warning("Стрім %s (спроба %d): інстанс віддав %d", video_id, attempt + 1, status)
        _URL_CACHE.pop(video_id, None)
        await asyncio.sleep(1.0)
    raise last_exc or RuntimeError("стрім не відкрився")


# ---------------------------------------------------------------- транскрайб

_TRANSCRIPT_MAX_SEGMENTS = 2000


def _transcript_sync(video_id: str, languages: list[str]) -> list[dict[str, Any]]:
    """Блокуючий виклик youtube-transcript-api — only через to_thread.

    API 1.x: YouTubeTranscriptApi().list() → FetchedTranscript(segments).
    """
    api = YouTubeTranscriptApi()
    listing = api.list(video_id)
    fetched = None
    # Спершу ручні субтитри бажаною мовою, потім автозгенеровані
    for codes in (languages, ["uk", "en"]):
        try:
            transcript = listing.find_transcript(codes)
            fetched = transcript.fetch()
            break
        except Exception:  # noqa: BLE001 — цієї мови немає, пробуємо наступну
            continue
    if fetched is None:
        # Останній шанс: перший-ліпший доступний трек субтитрів
        try:
            first = next(iter(listing))
            fetched = first.fetch()
        except StopIteration:
            raise RuntimeError("у відео немає субтитрів")
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(f"субтитри не читаються: {type(exc).__name__}") from exc
    segments: list[dict[str, Any]] = []
    for snippet in fetched:
        segments.append({
            "start": round(float(snippet.start), 2),
            "text": (snippet.text or "").replace("\n", " ").strip(),
        })
        if len(segments) >= _TRANSCRIPT_MAX_SEGMENTS:
            break
    return segments


async def transcript(video_id: str, languages: list[str] | None = None) -> list[dict[str, Any]]:
    """Сегменти субтитрів [{start, text}] або RuntimeError із людською причиною.

    Спершу прямий youtube-transcript-api (timedtext YouTube), якщо він
    закритий для IP — фолбек на Invidious-інстанси.
    """
    langs = [l for l in (languages or []) if isinstance(l, str) and l.strip()][:4]
    if YouTubeTranscriptApi is not None:
        try:
            return await asyncio.to_thread(_transcript_sync, video_id, langs)
        except Exception as exc:  # noqa: BLE001 — далі пробуємо Invidious
            log.warning("Прямий транскрайб %s не вдався (%s), пробую Invidious", video_id, type(exc).__name__)
    if not langs:
        langs = ["uk", "en"]
    bases = await all_invidious_instances()
    return await asyncio.to_thread(_invidious_captions_sync, video_id, langs + ["uk", "en"], bases)


def transcript_to_text(segments: list[dict[str, Any]], max_chars: int = 4000) -> str:
    """Склеює сегменти в звичайний текст для мозку (без таймкодів)."""
    parts: list[str] = []
    total = 0
    for seg in segments:
        text = seg.get("text", "")
        if not text:
            continue
        parts.append(text)
        total += len(text) + 1
        if total >= max_chars:
            break
    return " ".join(parts)[:max_chars].strip()


# --- Фолбек транскрайбу через Invidious: субтитри беремо з інстансу, якщо
# прямий timedtext YouTube закритий для цього IP ---

_VTT_TS = re.compile(r"^(?:(\d+):)?(\d+):(\d+)[.,](\d+)$")


def _vtt_seconds(stamp: str) -> float:
    match = _VTT_TS.match(stamp.strip())
    if not match:
        return 0.0
    h, m, s, ms = match.groups()
    return int(h or 0) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000


def _vtt_to_segments(vtt: str) -> list[dict[str, Any]]:
    """Мінімальний парсер WebVTT: блоки «таймкод --> таймкод» + текст."""
    segments: list[dict[str, Any]] = []
    current_start = None
    current_text: list[str] = []
    for line in vtt.splitlines():
        line = line.strip()
        if "-->" in line:
            if current_start is not None and current_text:
                segments.append({"start": round(current_start, 2), "text": " ".join(current_text)})
            current_start = _vtt_seconds(line.split("-->")[0])
            current_text = []
        elif line and not line.startswith(("WEBVTT", "Kind:", "Language:", "NOTE")) and current_start is not None:
            current_text.append(line)
    if current_start is not None and current_text:
        segments.append({"start": round(current_start, 2), "text": " ".join(current_text)})
    return segments[:_TRANSCRIPT_MAX_SEGMENTS]


def _invidious_captions_sync(video_id: str, languages: list[str], bases: list[str] | None = None) -> list[dict[str, Any]]:
    """Субтитри з першого живого Invidious-інстансу (WebVTT → сегменти)."""
    for base in (bases or invidious_instances()):
        try:
            with httpx.Client(timeout=httpx.Timeout(10.0), follow_redirects=True) as client:
                listing = client.get(f"{base}/api/v1/captions/{video_id}")
                if listing.status_code != 200:
                    continue
                items = (listing.json() or {}).get("captions") or []
                by_code = {item.get("code", ""): item for item in items}
                vtt = None
                for code in languages:
                    item = by_code.get(code)
                    if item:
                        vtt = client.get(base + item["url"]).text
                        break
                if vtt is None and items:
                    vtt = client.get(base + items[0]["url"]).text
                if vtt:
                    segments = _vtt_to_segments(vtt)
                    if segments:
                        return segments
        except Exception:  # noqa: BLE001 — інстанс мертвий/без субтитрів, пробуємо наступний
            continue
    raise RuntimeError("Invidious не віддав субтитрів")


# ---------------------------------------------------------------- проксі-стрім

# Заголовки відповіді, які ПРОКСЮЄМО нагору: без них перемотка не працює —
# <audio> чекає 206 + Content-Range.
_PASSTHROUGH_HEADERS = ("content-type", "content-length", "content-range", "accept-ranges")


async def open_stream(url: str, range_header: str | None, client_headers: dict[str, str] | None = None):
    """Відкриває upstream-потік із переданим Range. Повертає (status, headers, iterator).

    Ніякого буферу цілком: аудіо йде шматками по мірі читання — інакше
    10-хвилинний трек висів би в RAM Raspberry Pi.
    """
    headers: dict[str, str] = {}
    if range_header:
        # Range клієнта йде нагорі як є: googlevideo/icecast самі віддадуть 206
        headers["Range"] = range_header[:200]
    if client_headers:
        headers.update(client_headers)
    client = httpx.AsyncClient(timeout=httpx.Timeout(10.0, read=30.0), follow_redirects=True)
    try:
        req = client.build_request("GET", url, headers=headers)
        response = await client.send(req, stream=True)
    except Exception:
        await client.aclose()
        raise
    response_headers = {
        name: value
        for name, value in response.headers.items()
        if name.lower() in _PASSTHROUGH_HEADERS
    }

    async def iterator():
        try:
            async for chunk in response.aiter_bytes(65536):
                yield chunk
        finally:
            await response.aclose()
            await client.aclose()

    return response.status_code, response_headers, iterator()
