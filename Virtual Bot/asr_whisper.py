"""
«Клод Бот» — надійне розпізнавання української мови через Whisper (локально, ШІ).

Браузерний webkitSpeechRecognition виявився ненадійним (хмара Google часто віддає
«no-speech»), а MiMo ASR погано знає українську. Whisper (faster-whisper, CPU
int8) розпізнає українську ЧУДОВО, локально, без ключів і зовнішніх сервісів.

Потік: браузер (MediaRecorder, webm/opus) → /api/asr → ffmpeg у 16kHz mono wav →
faster-whisper → український текст.

Модель вантажиться ЛІНИВО (при першому запиті) і кешується в памʼяті процесу.
Розмір моделі — env WHISPER_MODEL (base|small|medium; типово base — швидко й точно).
"""

from __future__ import annotations

import logging
import os
import subprocess
import tempfile
import threading

log = logging.getLogger("virtual_bot.asr")

_MODEL_NAME = os.environ.get("WHISPER_MODEL", "base")
_model = None
_model_lock = threading.Lock()


def is_available() -> bool:
    """Чи можна розпізнавати (faster-whisper імпортується)."""
    try:
        import faster_whisper  # noqa: F401
        return True
    except Exception:  # noqa: BLE001
        return False


_warming = False


def warm() -> None:
    """Прогріває модель у фоні (щоб перше розпізнавання не чекало ~6с завантаження)."""
    global _warming
    if _model is not None or _warming or not is_available():
        return
    _warming = True

    def _load():
        global _warming
        try:
            _get_model()
        except Exception:  # noqa: BLE001
            log.warning("Whisper: не вдалося прогріти модель", exc_info=True)
        finally:
            _warming = False

    threading.Thread(target=_load, daemon=True).start()


def _get_model():
    """Лінива одноразова ініціалізація моделі (потокобезпечно)."""
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                from faster_whisper import WhisperModel
                log.info("Whisper: завантажую модель «%s» (перший раз може качати)…", _MODEL_NAME)
                _model = WhisperModel(_MODEL_NAME, device="cpu", compute_type="int8")
                log.info("Whisper: модель «%s» готова", _MODEL_NAME)
    return _model


def _to_wav16(audio_bytes: bytes, suffix: str) -> str:
    """ffmpeg: будь-який вхідний формат (webm/ogg/wav) → 16kHz mono wav. Повертає шлях."""
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as fin:
        fin.write(audio_bytes)
        in_path = fin.name
    out_path = in_path + ".16k.wav"
    try:
        subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
             "-i", in_path, "-ar", "16000", "-ac", "1", out_path],
            check=True, capture_output=True, timeout=30,
        )
    finally:
        try:
            os.unlink(in_path)
        except OSError:
            pass
    return out_path


def transcribe(audio_bytes: bytes, suffix: str = ".webm") -> str:
    """
    Розпізнає українську мову з аудіо-байтів. Блокуюча CPU-операція — викликати
    з threadpool (напр. asyncio.to_thread). Кидає виняток на помилці — ендпоінт
    перетворить на 503.
    """
    wav_path = _to_wav16(audio_bytes, suffix)
    try:
        model = _get_model()
        # ⚠️ БЕЗ vad_filter: на тихішому мікрофоні VAD видаляв УСЮ мову (лог:
        # «VAD filter removed 00:03.840 of audio» → порожній текст). Для коротких
        # реплік компаньйона фільтр не потрібен — Whisper і так дає порожньо на тиші.
        segments, _info = model.transcribe(
            wav_path,
            language="uk",
            beam_size=5,
        )
        text = " ".join(seg.text for seg in segments).strip()
        return text
    finally:
        try:
            os.unlink(wav_path)
        except OSError:
            pass
