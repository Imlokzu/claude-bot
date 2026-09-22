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
import pathlib
import re
import shutil
import subprocess
import tempfile
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
        # Пошук YouTube повертає не лише відео: перший рядок на запит по
        # імені — це майже завжди КАНАЛ (id виду UC…, 24 символи). Такий
        # «трек» не грає нічим і ніколи — саме він і був «відео не
        # вмикається» у списку. Відео — рівно 11 символів id.
        if len(str(entry["id"])) != 11:
            continue
        if str(entry.get("_type") or "url") in {"channel", "playlist"}:
            continue
        # Прямий ефір: у нього немає аудіо-itag'а (тільки HLS), тож
        # заграти його ми не можемо — але клієнт має це ПОКАЗАТИ, а не
        # дізнаватись тишею після тапу.
        live = bool(entry.get("is_live")) or str(entry.get("live_status") or "") == "is_live"
        out.append({
            "id": entry["id"],
            "title": entry.get("title") or "Без назви",
            "uploader": entry.get("uploader") or entry.get("channel") or "",
            "duration": int(entry["duration"]) if entry.get("duration") else 0,
            # Превʼю беремо з i.ytimg.com за id: у flat-пошуку yt-dlp мініатюри
            # приходять не завжди, а ця схема стабільна роками.
            "thumb": f"https://i.ytimg.com/vi/{entry['id']}/mqdefault.jpg",
            "live": live,
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


class LiveStreamUnsupported(RuntimeError):
    """Прямий ефір: аудіо-доріжки (itag 140) в нього немає, тільки HLS."""


def _extract_sync(video_id: str) -> str:
    opts = dict(_YDL_BASE)
    opts["format"] = "bestaudio/best"
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
    info = info or {}
    # Прямий ефір відрізаємо тут, поки причина ще відома: далі по стеку
    # лишиться тільки «жодне джерело не відповіло», і за цим текстом уже не
    # видно, що справа не в мережі, а в тому, що аудіо-доріжки просто немає.
    if info.get("is_live") or str(info.get("live_status") or "") == "is_live":
        raise LiveStreamUnsupported(video_id)
    return _pick_audio_url(info)


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
            # 200 із Content-Length: 0 — саме так виглядає прямий ефір:
            # інстанс не має чого віддати по itag 140. Раніше це доїжджало
            # до плеєра як «успішний» порожній потік, і трек просто не грав,
            # НІЧОГО не сказавши. Ретраї тут не помагають — це не флап.
            if headers.get("content-length") == "0":
                await body.aclose()
                raise LiveStreamUnsupported(video_id)
            return status, headers, body
        # 5xx від інстансу: закриваємо і ретраїмо з новою ссилкою
        await body.aclose()
        last_exc = RuntimeError(f"інстанс віддав {status}")
        log.warning("Стрім %s (спроба %d): інстанс віддав %d", video_id, attempt + 1, status)
        _URL_CACHE.pop(video_id, None)
        await asyncio.sleep(1.0)
    raise last_exc or RuntimeError("стрім не відкрився")


# ------------------------------------------------------------------- відео
#
# Тут інша механіка, ніж в аудіо, і не з примхи. Аудіо ми беремо через
# Invidious (`itag=140&local=true`), і для ВІДЕО той самий шлях не працює:
# перевірено на всіх трьох інстансах із конфігу — `itag=18` віддає
# text/html (504 / 502 / сторінку помилки), тобто змукшованої доріжки вони
# просто не проксюють.
#
# Робочий шлях — yt-dlp з КЛІЄНТОМ `android`. Це не «магія»: у web-клієнта
# googlevideo тепер вимагає PO-токен, і пряме посилання віддає 403 навіть із
# правильними заголовками (перевірено: web, tv, mweb, web_safari, ios — усі
# або 403, або «page needs to be reloaded»). Android-клієнт токена не
# вимагає, і itag 18 (mp4 360p, відео+звук в одному файлі) віддає 206 з
# `video/mp4`. 360p для екрана 320×240 — з запасом.
#
# Чому саме ЗМУКШОВАНИЙ itag, а не окремі доріжки: <video> у браузері не
# зіллє два потоки без MSE, а MSE на Raspberry Pi 3 — це вже плеєр, а не
# сторінка. Один файл грає штатний тег.

_ITAG_MUXED = 18
# Ті самі 30 хвилин, що й для аудіо, але СВІЙ кеш: інакше перемикання
# «дивитись → слухати» на тому самому відео віддавало б відео-ссилку в
# аудіо-плеєр (і навпаки), бо ключ у них один — id.
_VIDEO_CACHE: dict[str, tuple[float, str, dict[str, str]]] = {}


def _extract_video_sync(video_id: str) -> tuple[str, dict[str, str]]:
    """Блокуючий витяг ссилки на відео+звук. Повертає (url, заголовки)."""
    opts = dict(_YDL_BASE)
    # 480 як стеля, а не 360: якщо itag 18 для відео недоступний, хай візьме
    # найближчий змукшований, а не 1080p, який Pi не декодує.
    opts["format"] = f"{_ITAG_MUXED}/best[acodec!=none][vcodec!=none][height<=480]"
    opts["extractor_args"] = {"youtube": {"player_client": ["android"]}}
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
    info = info or {}
    if info.get("is_live") or str(info.get("live_status") or "") == "is_live":
        raise LiveStreamUnsupported(video_id)
    url = info.get("url") or ""
    if not url:
        raise RuntimeError("yt-dlp не віддав ссилку на відео")
    # http_headers обов'язкові: без User-Agent android-клієнта той самий
    # лінк відповідає 403.
    headers = {
        name: value
        for name, value in (info.get("http_headers") or {}).items()
        if name.lower() in ("user-agent", "accept", "accept-language", "sec-fetch-mode")
    }
    return url, headers


async def video_stream_url(video_id: str) -> tuple[str, dict[str, str]]:
    """Ссилка на потік відео+звук із кешем на 30 хвилин."""
    if yt_dlp is None:
        raise RuntimeError("yt-dlp недоступний — відео вміємо тільки з ним")
    cached = _VIDEO_CACHE.get(video_id)
    if cached and time.monotonic() - cached[0] < _URL_TTL_S:
        return cached[1], cached[2]
    url, headers = await asyncio.to_thread(_extract_video_sync, video_id)
    _VIDEO_CACHE[video_id] = (time.monotonic(), url, headers)
    return url, headers


async def open_video_stream(video_id: str, range_header: str | None, attempts: int = 2):
    """Відкриває потік відео з одним ретраєм по свіжій ссилці.

    Ссилки googlevideo мають строк життя (`expire` у query), і прострочена
    віддає 403. Тому невдача скидає кеш і пробує ще раз — інакше відео,
    поставлене на паузу на пів години, більше не запускалось.
    """
    last_exc: BaseException | None = None
    for attempt in range(attempts):
        url, headers = await video_stream_url(video_id)
        try:
            status, resp_headers, body = await open_stream(url, range_header, client_headers=headers)
        except Exception as exc:  # noqa: BLE001 — прострочена ссилка: беремо нову
            last_exc = exc
            _VIDEO_CACHE.pop(video_id, None)
            log.warning("Відео %s (спроба %d) не відкрилось: %s", video_id, attempt + 1, exc)
            continue
        if status in (200, 206):
            return status, resp_headers, body
        await body.aclose()
        last_exc = RuntimeError(f"джерело віддало {status}")
        _VIDEO_CACHE.pop(video_id, None)
        log.warning("Відео %s (спроба %d): джерело віддало %d", video_id, attempt + 1, status)
    raise last_exc or RuntimeError("відео не відкрилось")


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
    if not langs:
        langs = ["uk", "en"]

    blocked = False   # YouTube refused us, rather than the video lacking subs
    disabled = False  # the video itself carries no subtitles

    if YouTubeTranscriptApi is not None:
        try:
            return await asyncio.to_thread(_transcript_sync, video_id, langs)
        except Exception as exc:  # noqa: BLE001 — more sources below
            name = type(exc).__name__
            # Match by name, not by import: the library renames these between
            # majors, and a missing symbol here would turn a bad network day
            # into an ImportError on startup. The text is checked too, because
            # the helper above re-raises as RuntimeError and the original class
            # survives only inside the message.
            marks = f"{name} {exc}"
            if any(m in marks for m in ("IpBlocked", "RequestBlocked", "TooManyRequests", "429")):
                blocked = True
            elif any(m in marks for m in ("TranscriptsDisabled", "NoTranscriptFound")):
                disabled = True
            log.warning("Прямий транскрайб %s не вдався (%s)", video_id, name)

    try:
        return await asyncio.to_thread(_ytdlp_captions_sync, video_id, langs)
    except Exception as exc:  # noqa: BLE001 — Invidious still to try
        if "обмежує запити" in str(exc):
            blocked = True
        log.warning("yt-dlp транскрайб %s не вдався (%s)", video_id, type(exc).__name__)

    bases = await all_invidious_instances()
    try:
        return await asyncio.to_thread(
            _invidious_captions_sync, video_id, langs + ["uk", "en"], bases
        )
    except Exception as exc:  # noqa: BLE001 — last source, now explain honestly
        log.warning("Invidious транскрайб %s не вдався (%s)", video_id, type(exc).__name__)

    # Every source failed, so say WHY. Reporting "this video has no subtitles"
    # when the real cause is a rate-limited address sends the user hunting for
    # a different video, which cannot help — the block follows the address,
    # not the clip.
    if blocked:
        raise RuntimeError(
            "YouTube тимчасово обмежує запити з нашої адреси — це стосується "
            "будь-якого відео, не цього конкретного. Варто спробувати пізніше."
        )
    if disabled:
        raise RuntimeError("у цього відео вимкнені субтитри")
    raise RuntimeError("жодне джерело субтитрів зараз не відповідає")


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


def transcript_parts(
    segments: list[dict[str, Any]], part_chars: int = 12000
) -> list[dict[str, Any]]:
    """Ріже транскрайб на частини, які влазять в один запит до моделі.

    Чому не один суцільний текст: година розмови — це десятки тисяч
    символів, і цілком вони з'їдають вікно моделі. Чому не просто обрізати
    початок, як робили раніше: з 82 хвилин мозок бачив перші п'ять, чесно
    казав «текст обрізаний» — і на цьому все закінчувалось, бо попросити
    продовження було нічим.

    Кожна частина несе свій відрізок часу, щоб мозок міг сказати не просто
    «далі», а «на 40-й хвилині».
    """
    chunks: list[dict[str, Any]] = []
    buffer: list[str] = []
    size = 0
    start = float(segments[0].get("start", 0) or 0) if segments else 0.0

    def flush(end: float) -> None:
        if not buffer:
            return
        chunks.append({
            "text": " ".join(buffer).strip(),
            "start_sec": int(start),
            "end_sec": int(end),
        })

    for seg in segments:
        text = seg.get("text", "")
        if not text:
            continue
        if size and size + len(text) + 1 > part_chars:
            flush(float(seg.get("start", 0) or 0))
            start = float(seg.get("start", 0) or 0)
            buffer, size = [], 0
        buffer.append(text)
        size += len(text) + 1

    last = float(segments[-1].get("start", 0) or 0) if segments else 0.0
    flush(last)
    return chunks


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


def _ytdlp_captions_sync(video_id: str, languages: list[str]) -> list[dict[str, Any]]:
    """Subtitles via yt-dlp, as a second source when timedtext is closed.

    Why a third path at all: the direct timedtext endpoint gets shut off per
    IP, and the public Invidious instances this code falls back to are mostly
    dead (530/502, or an HTML error page where JSON should be). yt-dlp goes
    through YouTube's player API instead, is actively maintained against
    exactly this kind of breakage, and is already installed here.

    It is not a cure for an IP ban — a banned address gets HTTP 429 here too —
    so the caller still has to tell the user the truth when every path fails.
    """
    binary = shutil.which("yt-dlp")
    if not binary:
        raise RuntimeError("yt-dlp не встановлено")

    wanted = [code for code in (languages or []) if code] or ["uk", "en"]
    with tempfile.TemporaryDirectory(prefix="vbot-subs-") as workdir:
        done = subprocess.run(
            [
                binary, "--skip-download",
                # Both flags: a video may carry human subtitles, automatic
                # ones, or only one of the two.
                "--write-subs", "--write-auto-subs",
                "--sub-langs", ",".join(wanted + ["uk", "en"]),
                "--sub-format", "vtt",
                "--no-playlist", "--no-warnings", "--quiet",
                "-o", f"{workdir}/%(id)s",
                f"https://www.youtube.com/watch?v={video_id}",
            ],
            capture_output=True, text=True, timeout=90, check=False,
        )
        files = sorted(pathlib.Path(workdir).glob("*.vtt"))
        if not files:
            stderr = (done.stderr or "").strip()
            if "429" in stderr or "Too Many Requests" in stderr:
                raise RuntimeError("YouTube обмежує запити з нашої адреси")
            raise RuntimeError("yt-dlp не віддав субтитрів")

        # Prefer a file whose language suffix was actually asked for; the glob
        # order otherwise depends on the filesystem.
        def rank(path: pathlib.Path) -> int:
            for index, code in enumerate(wanted):
                if f".{code}." in path.name:
                    return index
            return len(wanted)

        best = min(files, key=rank)
        return _vtt_to_segments(best.read_text(encoding="utf-8", errors="replace"))


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
