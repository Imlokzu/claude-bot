"""
Тули відео для мозку: увімкнути ролик З КАРТИНКОЮ на екрані бота і керувати
плеєром словами — пауза, перемотка, кінець, швидкість.

Різниця з music_tools (спитають — скажи саме так):
- play_music  → звук у Now Playing, бар знизу, грає далі після закриття
                застосунку. Це «постав музику».
- play_video  → застосунок YouTube на весь екран, картинка + звук, з
                пропуском вклеєної реклами (SponsorBlock). Це «покажи відео».

Команди летять SSE-подією до екрана; екран сам відкриває застосунок, якщо
той закритий. Тул НЕ чекає підтвердження: якщо екран зараз ніхто не показує,
подія просто нікуди не прийде — це нормальний стан для «софт спочатку,
залізо потім», а не помилка (той самий контракт, що в screen_tools).
"""

from __future__ import annotations

import logging

import events
import music
import screen_store
import sponsorblock
import video_control as vc

log = logging.getLogger("virtual_bot.tools.video")


def _ensure_app_installed() -> str:
    """Застосунок youtube мусить бути встановлений, інакше грати нічому.

    Ставимо самі: це пакет із нашого ж репозиторію, а не чужий код, і
    вимагати «зайди в магазин і встанови» у відповідь на «покажи відео» —
    means просити людину зробити роботу за бота.
    """
    try:
        if screen_store.is_installed(vc.APP_PKG):
            return ""
        screen_store.install(vc.APP_PKG)
        log.info("📦 Застосунок %s встановлено автоматично (для відео)", vc.APP_PKG)
        return "Застосунок YouTube встановлено автоматично."
    except screen_store.StoreError as exc:
        log.warning("Не вдалося встановити %s: %s", vc.APP_PKG, exc)
        return ""


async def play_video(query: str = "", url: str = "", start: str = "") -> dict:
    """Знайти відео і показати його на екрані пристрою — з картинкою."""
    query = (query or "").strip()
    url = (url or "").strip()

    video_id = music.parse_video_id(url) if url else None
    if url and video_id is None:
        # Посилання дали, але не на YouTube — не робимо вигляд, що шукаємо
        return {"error": "Це не схоже на посилання YouTube. Потрібне watch?v=… або youtu.be/…"}

    if video_id:
        track = {"provider": "youtube", "id": video_id, "title": query or "Відео", "uploader": "", "duration": 0}
        # Метадані підтягуємо пошуком по id: без назви бар і заголовок
        # плеєра показували б «Відео», і людина не бачила б, що саме грає.
        found = await music.search(video_id, limit=1)
        if found and found[0].get("id") == video_id:
            track = found[0]
    elif query:
        tracks = await music.search(query, limit=3)
        if not tracks:
            return {"error": "Нічого не знайшов (або yt-dlp не встановлений: pip install yt-dlp)"}
        track = tracks[0]
        if track.get("live"):
            # Прямий ефір у нас не грає ні відео, ні звуком (тільки HLS) —
            # кажемо це відразу, а не після чорного екрана
            alt = next((t for t in tracks[1:] if not t.get("live")), None)
            if alt is None:
                return {"error": f"«{track['title']}» — прямий ефір, а ефіри ми поки не граємо, лише записи."}
            track = alt
    else:
        return {"error": "Що показати? Дай назву відео або посилання."}

    note_install = _ensure_app_installed()

    start_at = vc.parse_position(start) if start else None
    command = {"action": "play", "track": track}
    if start_at:
        command["position"] = round(start_at, 2)
    events.publish_video(command)

    skip = await vc.segments_for(track["id"])
    log.info("🎬 Відео на екрані: %s", track.get("title", track["id"]))

    result = {
        "ok": True,
        "playing": f"{track.get('title', '')} — {track.get('uploader', '')}".strip(" —"),
        "video_id": track["id"],
        "duration_human": vc.human_time(track.get("duration", 0)),
        "note": "Відео вже грає на екрані пристрою, з картинкою і звуком.",
    }
    if start_at:
        result["started_at"] = vc.human_time(start_at)
    if skip["enabled"]:
        result["adblock"] = (
            f"Вклеєної реклами знайдено {len(skip['segments'])} шматків "
            f"({skip['skipped_seconds']} с) — плеєр пропустить їх сам."
            if skip["segments"] else "Вклеєної реклами в цьому відео не знайдено."
        )
    else:
        result["adblock"] = "Пропуск реклами (SponsorBlock) зараз вимкнений у налаштуваннях."
    if note_install:
        result["installed"] = note_install
    return result


async def video_control(action: str, seconds: str = "", position: str = "", rate: str = "") -> dict:
    """Керувати тим, що вже грає: пауза, перемотка, кінець, швидкість."""
    try:
        command = vc.build_command(action, seconds=seconds, position=position, rate=rate)
    except vc.VideoError as exc:
        return {"error": str(exc)}

    events.publish_video(command)
    if command["action"] == "stop":
        vc.clear_state()
    log.info("🎬 Плеєр: %s", vc.describe(command))

    snapshot = vc.state()
    result = {"ok": True, "done": vc.describe(command), "action": command["action"]}
    if not snapshot.get("playing") and not snapshot.get("video_id"):
        # Команду відправили, але екран нічого не грав. Це не помилка (екран
        # міг щойно ожити), проте мовчати про це — означало б дати боту
        # звітувати «перемотав» у порожнечу.
        result["warning"] = (
            "Екран не повідомляв, що зараз щось грає. Якщо відео не було — "
            "спочатку увімкни його через play_video."
        )
    else:
        result["was_playing"] = snapshot.get("title", "")
        result["position_before"] = snapshot.get("position_human", "")
    return result


async def video_status() -> dict:
    """Що зараз на екрані: назва, позиція, скільки лишилось, скільки пропущено."""
    snapshot = vc.state()
    if not snapshot.get("video_id"):
        return {
            "playing": False,
            "note": snapshot.get("note", "Зараз на екрані відео не грає."),
        }
    out = {
        "playing": bool(snapshot.get("playing")),
        "paused": bool(snapshot.get("paused")),
        "title": snapshot.get("title", ""),
        "video_id": snapshot.get("video_id", ""),
        "position": snapshot.get("position_human", ""),
        "duration": snapshot.get("duration_human", ""),
        "left": snapshot.get("left_human", ""),
        "speed": f"{snapshot.get('rate', 1)}×",
        "muted": bool(snapshot.get("muted")),
    }
    if snapshot.get("skipped_count"):
        out["adblock_skipped"] = (
            f"{int(snapshot['skipped_count'])} рекламних шматків "
            f"({vc.human_time(snapshot.get('skipped_seconds', 0))})"
        )
    return out


async def video_settings(sponsorblock_enabled: str = "", categories: str = "",
                         proxy_thumbnails: str = "") -> dict:
    """Показати або змінити налаштування: адблок, категорії, приватність прев'ю."""
    patch: dict = {}

    def as_bool(value: str) -> bool | None:
        text = str(value or "").strip().lower()
        if not text:
            return None
        if text in ("1", "true", "yes", "on", "так", "увімкни", "вкл", "enable", "enabled"):
            return True
        if text in ("0", "false", "no", "off", "ні", "нi", "вимкни", "викл", "disable", "disabled"):
            return False
        return None

    enabled = as_bool(sponsorblock_enabled)
    if enabled is not None:
        patch["sponsorblock"] = enabled
    proxy = as_bool(proxy_thumbnails)
    if proxy is not None:
        patch["proxy_thumbnails"] = proxy
    if categories.strip():
        wanted = sponsorblock.clean_categories(
            [part.strip() for part in categories.replace(";", ",").split(",")]
        )
        if not wanted:
            return {
                "error": "Не впізнав категорії. Доступні: "
                + ", ".join(f"{key} ({label})" for key, label in sponsorblock.CATEGORIES.items()),
            }
        patch["categories"] = wanted
        # Назвати категорії й лишити пропуск вимкненим — суперечність:
        # людина щойно сказала, ЩО пропускати.
        patch.setdefault("sponsorblock", True)

    if patch:
        try:
            settings = vc.save_settings(patch)
        except vc.VideoError as exc:
            return {"error": str(exc)}
        changed = True
    else:
        settings = vc.load_settings()
        changed = False

    return {
        "ok": True,
        "changed": changed,
        "adblock": "увімкнено" if settings["sponsorblock"] else "вимкнено",
        "skipping": [sponsorblock.CATEGORIES[c] for c in settings["categories"]],
        "proxy_thumbnails": settings["proxy_thumbnails"],
        "note": (
            "Реклама, яку вставляє сам YouTube, до нас і так не доходить — "
            "відео йде проксі-потоком без плеєра YouTube. Ці налаштування "
            "стосуються реклами, ВКЛЕЄНОЇ в саме відео (база SponsorBlock)."
        ),
        "available_categories": {k: v for k, v in sponsorblock.CATEGORIES.items()},
    }


SCHEMAS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "play_video",
            "description": (
                "Показати ВІДЕО з YouTube на екрані пристрою — з КАРТИНКОЮ, на весь "
                "екран, з автоматичним пропуском вклеєної реклами. Використовуй, коли "
                "просять «покажи відео», «увімкни ролик», «постав на екран …», "
                "«знайди відео про …» або кидають посилання й хочуть ДИВИТИСЬ. "
                "Якщо просять саме МУЗИКУ/звук у фоні — бери play_music."
            ),
            "parameters": {
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
        },
    },
    {
        "type": "function",
        "function": {
            "name": "video_control",
            "description": (
                "Керувати відео, яке ВЖЕ грає на екрані: пауза, продовжити, зупинити, "
                "перемотати вперед/назад, стрибнути на час, у початок, у кінець, "
                "змінити швидкість, приглушити. Використовуй на «стоп», «пауза», "
                "«перемотай вперед», «на 5 хвилині», «в кінець», «швидше»."
            ),
            "parameters": {
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
        },
    },
    {
        "type": "function",
        "function": {
            "name": "video_status",
            "description": (
                "Дізнатися, що зараз грає на екрані: назва, позиція, скільки лишилось, "
                "швидкість, скільки реклами пропущено. Викликай ПЕРЕД тим, як казати "
                "щось про поточне відео — інакше вигадаєш."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "video_settings",
            "description": (
                "Показати або змінити налаштування відео: пропуск вклеєної реклами "
                "(SponsorBlock), які категорії пропускати, чи тягнути прев'ю через "
                "бота замість серверів Google. Без аргументів — просто показує стан. "
                "Використовуй на «вимкни пропуск реклами», «не пропускай інтро», "
                "«що там з адблоком»."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "sponsorblock_enabled": {
                        "type": "string",
                        "description": "«on»/«off» — увімкнути чи вимкнути пропуск реклами.",
                    },
                    "categories": {
                        "type": "string",
                        "description": (
                            "Що пропускати, через кому: sponsor, selfpromo, interaction, "
                            "intro, outro, preview, filler, music_offtopic."
                        ),
                    },
                    "proxy_thumbnails": {
                        "type": "string",
                        "description": "«on»/«off» — прев'ю через бота (приватність) чи напряму з Google.",
                    },
                },
            },
        },
    },
]

HANDLERS = {
    "play_video": play_video,
    "video_control": video_control,
    "video_status": video_status,
    "video_settings": video_settings,
}
