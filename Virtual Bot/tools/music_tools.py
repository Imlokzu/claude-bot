"""
Тули музики для мозку: увімкнути трек на екрані бота і «послухати» відео.

- play_music — шукає трек на YouTube (неофіційно, через yt-dlp) і шле
  SSE-подію music: екран пристрою починає грати його в Now Playing.
- listen_to_video — качає субтитри відео (youtube-transcript-api,
  безкоштовно, без ключа) і повертає їх текстом: так бот реально
  знайомиться зі змістом відео, яке йому включили.
"""

from __future__ import annotations

import logging

import events
import music

log = logging.getLogger("virtual_bot.tools.music")

# Скільки тексту транскрайбу віддаємо мозку: більше — і промпт роздується
# понад бюджет маленьких моделей
TRANSCRIPT_CHARS = 4000


async def play_music(query: str) -> dict:
    """Пошук трека за назвою + старт відтворення на екрані пристрою."""
    query = (query or "").strip()
    if not query:
        return {"error": "Вкажи, що увімкнути: назву пісні або виконавця"}
    tracks = await music.search(query, limit=3)
    if not tracks:
        return {
            "error": "Нічого не знайшов (або yt-dlp не встановлений). "
            "Перевір: pip install yt-dlp",
        }
    track = tracks[0]
    events.publish_music(track)
    log.info("🎵 Грає: %s — %s", track["title"], track.get("uploader", ""))
    others = [
        {"title": t["title"], "uploader": t.get("uploader", ""), "id": t["id"]}
        for t in tracks[1:]
    ]
    return {
        "ok": True,
        "playing": f"{track['title']} — {track.get('uploader', '')}",
        "note": "Трек уже грає на екрані пристрою (Now Playing знизу).",
        "alternatives": others,
    }


async def stop_music() -> dict:
    events.publish_music({}, action="stop")
    return {"ok": True, "note": "Музику зупинено."}


async def listen_to_video(url: str, lang: str = "uk") -> dict:
    """Транскрайб YouTube-відео текстом — щоб бот знав, про що воно."""
    video_id = music.parse_video_id(url)
    if not video_id:
        return {
            "error": "Це не схоже на посилання YouTube. Потрібне https://youtube.com/watch?v=… або https://youtu.be/…"
        }
    try:
        segments = await music.transcript(video_id, [lang, "uk", "en"])
    except RuntimeError as exc:
        return {"error": f"Субтитри недоступні: {exc}"}
    except Exception as exc:  # noqa: BLE001 — мережа/версія бібліотеки
        log.warning("Транскрайб %s не вдався: %s", video_id, exc)
        return {"error": f"Субтитри не вдалося завантажити: {type(exc).__name__}"}
    if not segments:
        return {"error": "Субтитри порожні."}

    text = music.transcript_to_text(segments, max_chars=TRANSCRIPT_CHARS)
    total = segments[-1]["start"] if segments else 0

    # Заодно включаємо відео на екрані: користувач слухає, бот читає
    events.publish_music({"provider": "youtube", "id": video_id})

    return {
        "ok": True,
        "video_id": video_id,
        "duration_sec": int(total),
        "segments": len(segments),
        "note": (
            "Відео грає на екрані пристрою. Нижче — текст транскрайбу (можливо, "
            "обрізаний). Обговорюй ЗМІСТ за ним, а не вигадуй. "
            "Якщо текст обрізаний і не вистачає — скажи про це."
        ),
        "transcript": text,
    }


SCHEMAS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "play_music",
            "description": (
                "Увімкнути музику на ЕКРАНІ ПРИСТРОЮ бота (Now Playing знизу). "
                "Шукає на YouTube і починає відтворення. Використовуй, коли "
                "просять «увімкни пісню», «постав музику», «хочу послухати …»."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Що шукати, напр. «Океан Ельзи Обіймай» або «lofi beats».",
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "stop_music",
            "description": "Зупинити музику на екрані пристрою.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "listen_to_video",
            "description": (
                "ПРОЧИТАТИ зміст YouTube-відео через субтитри (безкоштовний "
                "транскрайб) і ввімкнути його звук на екрані пристрою. "
                "Використовуй, коли користувач кидає посилання на відео або "
                "просить «подивись/послухай це відео»."
            ),
            "parameters": {
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
                },
                "required": ["url"],
            },
        },
    },
]

HANDLERS = {
    "play_music": play_music,
    "stop_music": stop_music,
    "listen_to_video": listen_to_video,
}
