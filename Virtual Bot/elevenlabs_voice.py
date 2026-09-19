"""
«Клод Бот» — голос через ElevenLabs (хмарний нейронний TTS).

Навіщо поруч із Piper: Piper локальний і безкоштовний, але це модель 2023-го
року — інтонація рівна. ElevenLabs дає живішу подачу й читає українську
(модель eleven_flash_v2_5, 32 мови). Ціна — мережа й ключ.

Заміряно на фразі у 85 символів (2026-09-04, цей ключ):
  eleven_flash_v2_5       TTFB 0.38 с
  eleven_turbo_v2_5       TTFB 0.36 с
  eleven_multilingual_v2  TTFB 1.01 с
Тому дефолт — flash: для розмови вголос затримка важливіша за останні
відсотки якості.

⚠️ Голоси. Ключ, що є, не має дозволів voices_read/models_read, тож список
голосів АКАУНТА прочитати не можна — імена нижче зашиті за їхніми публічними
voice_id, і кожен із них перевірено цим ключем (200 + аудіо). Голоси з
«бібліотеки» на безкоштовному тарифі API не віддає (402 paid_plan_required) —
саме тому тут лише ці три. Свій голос можна дописати в config.yaml
(tts.elevenlabs.voices), нічого не змінюючи в коді.

Контракт модуля — той самий, що в piper_voice (is_available / VOICES /
get_speaker / set_speaker / SPEEDS / synthesize), щоб main.py міг вибирати
провайдера, не знаючи його нутра.
"""
from __future__ import annotations

import logging

import httpx

import app_config
import tts_text

log = logging.getLogger("virtual_bot.tts.elevenlabs")

API_BASE = "https://api.elevenlabs.io/v1"
MEDIA_TYPE = "audio/mpeg"

# id — цілі числа, а не voice_id: так лишається старий контракт /api/tts/voice
# (панель і екран шлють number), а самі voice_id живуть тільки тут.
# Порядок має значення: VOICES[0] — це голос за замовчуванням.
_BUILTIN_VOICES = [
    {"id": 1, "name": "Джордж", "hint": "чоловічий, спокійний", "voice_id": "JBFqnCBsd6RMkjVDRZzb"},
    {"id": 2, "name": "Адам", "hint": "чоловічий, глибокий", "voice_id": "pNInz6obpgDQGcFmaJgB"},
    {"id": 0, "name": "Сара", "hint": "жіночий, теплий", "voice_id": "EXAVITQu4vr4xnSDxMaL"},
]


def _config_voices() -> list[dict]:
    """Голоси з config.yaml (tts.elevenlabs.voices) — дописані користувачем."""
    raw = app_config.cfg("tts", "elevenlabs", "voices", default=None)
    out: list[dict] = []
    for i, item in enumerate(raw if isinstance(raw, list) else []):
        if not isinstance(item, dict):
            continue
        voice_id = str(item.get("voice_id") or "").strip()
        if not voice_id:
            continue
        out.append({
            "id": int(item.get("id", 100 + i)),
            "name": str(item.get("name") or voice_id[:8]),
            "hint": str(item.get("hint") or ""),
            "voice_id": voice_id,
        })
    return out


VOICES = _config_voices() or _BUILTIN_VOICES

# voice_settings.speed в ElevenLabs — 0.7…1.2, і це НЕ те саме, що
# --length-scale у Piper: там 2× реально працює, тут вище 1.2 API не дає.
# Тому список темпів у провайдера свій, а фронтенд бере його з /api/tts/status.
SPEEDS = [1.0, 1.1, 1.2]
MIN_SPEED = 0.7
MAX_SPEED = 1.2

_current_speaker = int(VOICES[0]["id"]) if VOICES else 0


def _voice_by_id(speaker: int | None) -> dict | None:
    want = _current_speaker if speaker is None else int(speaker)
    for voice in VOICES:
        if int(voice["id"]) == want:
            return voice
    return VOICES[0] if VOICES else None


def get_speaker() -> int:
    return _current_speaker


def set_speaker(speaker: int | None) -> bool:
    """Ставить активний голос. False — такого голосу немає."""
    global _current_speaker
    voice = None
    for item in VOICES:
        if speaker is not None and int(item["id"]) == int(speaker):
            voice = item
            break
    if voice is None:
        return False
    _current_speaker = int(voice["id"])
    return True


def model() -> str:
    return str(app_config.cfg("tts", "elevenlabs", "model", default="eleven_flash_v2_5"))


def output_format() -> str:
    return str(app_config.cfg("tts", "elevenlabs", "output_format", default="mp3_22050_32"))


def is_available() -> bool:
    """Чи є ключ (без нього провайдер просто не існує)."""
    return bool(app_config.get_elevenlabs_key()) and bool(VOICES)


def synthesize(text: str, speaker: int | None = None, speed: float = 1.0) -> bytes:
    """
    Озвучує текст голосом ElevenLabs. Повертає MP3-байти.
    Кидає виняток на помилці — ендпоінт із нього робить 503, а провайдер
    вище (main._tts_backend) відкочується на Piper.
    """
    key = app_config.get_elevenlabs_key()
    if not key:
        raise RuntimeError("Немає ELEVENLABS_API_KEY")
    voice = _voice_by_id(speaker)
    if voice is None:
        raise RuntimeError("Не налаштовано жодного голосу ElevenLabs")

    # Регістр лишаємо як є: на відміну від Piper, ця модель із великих літер
    # читає абревіатури й імена ПРАВИЛЬНО, а lower() їй тільки шкодить.
    clean = tts_text.clean_for_speech(text)[:2000]
    if not clean:
        raise RuntimeError("Порожній текст для озвучки")

    model_id = model()
    payload: dict = {
        "text": clean,
        "model_id": model_id,
        "voice_settings": {
            "speed": round(min(MAX_SPEED, max(MIN_SPEED, float(speed or 1.0))), 2),
        },
    }
    # language_code розуміють лише *_v2_5: у multilingual_v2 його немає в схемі
    if model_id.endswith("_v2_5"):
        payload["language_code"] = "uk"

    url = f"{API_BASE}/text-to-speech/{voice['voice_id']}"
    with httpx.Client(timeout=httpx.Timeout(30.0)) as client:
        response = client.post(
            url,
            params={"output_format": output_format()},
            headers={"xi-api-key": key, "Content-Type": "application/json"},
            json=payload,
        )
    if response.status_code != 200:
        detail = response.text[:200]
        log.warning("ElevenLabs %s: %s", response.status_code, detail)
        raise RuntimeError(f"ElevenLabs {response.status_code}: {detail}")
    data = response.content
    if not data:
        raise RuntimeError("ElevenLabs повернув порожнє аудіо")
    return data
