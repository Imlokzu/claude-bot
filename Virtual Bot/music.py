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

log = logging.getLogger("virtual_bot.music")

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


async def audio_stream_url(video_id: str) -> str:
    """Пряма аудіо-ссилка для відео (кешована). Кидає RuntimeError якщо ні."""
    if yt_dlp is None:
        raise RuntimeError("yt-dlp не встановлено")
    cached = _URL_CACHE.get(video_id)
    if cached and time.monotonic() - cached[0] < _URL_TTL_S:
        return cached[1]
    url = await asyncio.to_thread(_extract_sync, video_id)
    _URL_CACHE[video_id] = (time.monotonic(), url)
    return url


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
    """Сегменти субтитрів [{start, text}] або RuntimeError із людською причиною."""
    if YouTubeTranscriptApi is None:
        raise RuntimeError("youtube-transcript-api не встановлено")
    langs = [l for l in (languages or []) if isinstance(l, str) and l.strip()][:4]
    return await asyncio.to_thread(_transcript_sync, video_id, langs)


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


# ---------------------------------------------------------------- проксі-стрім

# Заголовки відповіді, які ПРОКСЮЄМО нагору: без них перемотка не працює —
# <audio> чекає 206 + Content-Range.
_PASSTHROUGH_HEADERS = ("content-type", "content-length", "content-range", "accept-ranges")


async def open_stream(url: str, range_header: str | None, client_headers: dict[str, str] | None = None):
    """Відкриває upstream-потік із переданим Range. Повертає (status, headers, iterator).

    Ніякого буферу цілком: аудіо йде шматками по мірі читання — інакше
    10-хвилинний трек висів би в RAM Raspberry Pi.
    """
    headers: dict[str, str] = {"User-Agent": "ClaudeBot/1.0"}
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
