"""
«Клод Бот» — живий голос через MiMo (Xiaomi, OpenAI-сумісний провайдер).

Мозок лишається OpenClaw — MiMo лише ОЗВУЧУЄ його відповідь «живим» ШІ-голосом
(набагато природнішим за браузерний speechSynthesis). Модуль самодостатній і
легко зняти/замінити, бо провайдер тимчасовий.

TTS-формат MiMo НЕСТАНДАРТНИЙ: не /audio/speech, а /chat/completions з моделлю
mimo-v2.5-tts і текстом у ASSISTANT-повідомленні → відповідь містить
choices[0].message.audio.data (base64 WAV, 24kHz mono).

Ключ — секрет (env MIMO_API_KEY), у відповідях/логах не світимо.
"""

from __future__ import annotations

import base64
import os
import re

import httpx

TTS_MODEL = "mimo-v2.5-tts"
_TIMEOUT_S = 30.0


def get_key() -> str | None:
    """Ключ MiMo — тільки з env MIMO_API_KEY. None — вимкнено. Секрет, не логувати!"""
    key = os.environ.get("MIMO_API_KEY", "").strip()
    return key or None


def _base_url() -> str:
    return os.environ.get("MIMO_BASE_URL", "https://token-plan-sgp.xiaomimimo.com/v1").rstrip("/")


def is_enabled() -> bool:
    return get_key() is not None


# Прибираємо markdown/зайве, щоб голос не читав «зірочка-зірочка» тощо.
_MD_RE = re.compile(r"[*_`#>]+")


def _clean_for_speech(text: str) -> str:
    text = _MD_RE.sub("", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:1000]  # розумна стеля на одну репліку


async def synthesize(text: str) -> bytes:
    """
    Озвучує text голосом MiMo. Повертає WAV-байти. Кидає RuntimeError на будь-якій
    проблемі (ключ/мережа/формат), щоб ендпоінт міг відповісти 503, а фронтенд —
    відкотитись на браузерний голос.
    """
    key = get_key()
    if not key:
        raise RuntimeError("MiMo вимкнено (немає MIMO_API_KEY)")
    clean = _clean_for_speech(text)
    if not clean:
        raise RuntimeError("Порожній текст для озвучки")

    payload = {
        "model": TTS_MODEL,
        # Текст для озвучки MiMo очікує саме в assistant-повідомленні
        "messages": [{"role": "assistant", "content": clean}],
        "stream": False,
    }
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=_TIMEOUT_S) as client:
        resp = await client.post(f"{_base_url()}/chat/completions", headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()
    try:
        b64 = data["choices"][0]["message"]["audio"]["data"]
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError("Неочікуваний формат TTS-відповіді MiMo") from exc
    if not isinstance(b64, str) or not b64:
        raise RuntimeError("Порожня аудіо-відповідь MiMo")
    try:
        return base64.b64decode(b64)
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError("Не вдалося декодувати аудіо MiMo") from exc
