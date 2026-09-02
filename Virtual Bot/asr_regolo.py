"""Regolo Speech-to-Text adapter for the Virtual Bot."""

from __future__ import annotations

import logging
from typing import Any

import httpx

import app_config as cfg

log = logging.getLogger("virtual_bot.asr_regolo")

_TRANSCRIPT_PATH = "/audio/transcriptions"


def is_available() -> bool:
    """Чи налаштований активний Regolo ASR без розкриття ключа."""
    return (
        cfg.ASR_PROVIDER == "regolo"
        and bool(cfg.get_regolo_asr_key() and cfg.REGOLO_ASR_BASE_URL and cfg.REGOLO_ASR_MODEL)
    )


def _response_text(response: httpx.Response) -> str:
    """Дістає transcript із plain-text або стандартної JSON-відповіді."""
    content_type = (response.headers.get("content-type") or "").lower()
    if "json" in content_type:
        payload: Any = response.json()
        text = payload.get("text") if isinstance(payload, dict) else None
    else:
        text = response.text
    if not isinstance(text, str):
        raise RuntimeError("Regolo ASR повернув некоректний текст")
    return text.strip()


async def transcribe(
    audio_bytes: bytes,
    filename: str = "voice.webm",
    content_type: str | None = None,
) -> str:
    """Розпізнає аудіо через Regolo без локального fallback."""
    key = cfg.get_regolo_asr_key()
    if not key:
        raise RuntimeError("Regolo ASR не налаштований")
    if not audio_bytes:
        raise RuntimeError("Порожнє аудіо")

    media_type = content_type or "application/octet-stream"
    files = {"file": (filename or "voice.webm", audio_bytes, media_type)}
    data = {
        "model": cfg.REGOLO_ASR_MODEL,
        "language": cfg.REGOLO_ASR_LANGUAGE,
        "response_format": "text",
    }
    # Ті самі підказки, що й у локального Whisper (`asr.hotwords`): в
    # OpenAI-сумісному контракті вони називаються `prompt`. Порожній рядок не
    # надсилаємо — деякі сервери на пустому полі відповідають 400.
    if cfg.ASR_HOTWORDS:
        data["prompt"] = cfg.ASR_HOTWORDS
    url = f"{cfg.REGOLO_ASR_BASE_URL.rstrip('/')}{_TRANSCRIPT_PATH}"
    headers = {"Authorization": f"Bearer {key}"}

    try:
        async with httpx.AsyncClient(
            timeout=cfg.REGOLO_ASR_TIMEOUT_S,
            trust_env=cfg.httpx_trust_env(cfg.REGOLO_ASR_BASE_URL),
        ) as client:
            response = await client.post(url, headers=headers, data=data, files=files)
        response.raise_for_status()
        return _response_text(response)
    except (httpx.HTTPError, ValueError, TypeError) as exc:
        log.warning("Regolo ASR запит не вдався (%s)", type(exc).__name__)
        raise RuntimeError("Regolo ASR недоступний") from exc
