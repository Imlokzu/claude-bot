"""
"Claude Bot" — live UKRAINIAN voice via Piper TTS (neural, local, AI).

MiMo TTS (Xiaomi) does not have a Ukrainian voice — read Cyrillic with Chinese/Italian
jargon (verified round-trip via Whisper). Browser speechSynthesis — robotic.
Piper — neural Ukrainian model `uk_UA-ukrainian_tts-medium`: natural voice,
on-device, free, without external services (privacy).

Flow: text → (lowercase + markdown cleanup) → piper CLI → 22kHz wav.

⚠️ The model does NOT have uppercase letters in the phoneme-map (П/К/Б... drop out) → text BEFORE
synthesis is converted to LOWERCASE (this does not affect pronunciation).
"""

from __future__ import annotations

import logging
import os
import re
import subprocess
import sys
import tempfile

import tts_text
import voice_latin

log = logging.getLogger("virtual_bot.tts")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
_MODEL = os.environ.get(
    "PIPER_MODEL",
    os.path.join(BASE_DIR, "voices", "uk_UA-ukrainian_tts-medium.onnx"),
)

# Voices inside the model (multi-speaker). lada sounds childish — by
# default we take the adult one. Order/names — from speaker_id_map of the config.
VOICES = [
    {"id": 1, "name": "Микита", "hint": "чоловічий, дорослий"},
    {"id": 2, "name": "Тетяна", "hint": "жіночий, дорослий"},
    {"id": 0, "name": "Лада", "hint": "жіночий, молодший"},
]
_DEFAULT_SPEAKER = int(os.environ.get("PIPER_SPEAKER", "1"))
_current_speaker = _DEFAULT_SPEAKER

# Speech rate. Piper controls it via --length-scale — this is the LENGTH of a phoneme,
# i.e., the value INVERSE to the speed: 0.5 = twice as fast. Therefore speed from
# the request is inverted, and not passed as is.
#
# We do this by synthesis, and not by playbackRate in the player: speeding up ready audio
# stretches the spectrum and adds "gurgling", and the model at a lower length-scale
# simply speaks faster, remaining itself.
SPEEDS = [1.0, 1.5, 2.0]
MIN_SPEED = 0.5
MAX_SPEED = 3.0                 # higher the Ukrainian pronunciation falls apart

# Measured round-trip via Whisper: at 1.5× text is recognized verbatim, at
# 2× pronunciation already floats («Raspberry Pi» → «SbriPy»). Therefore 2.0 remains in the list
# as a conscious user choice, and not as a safe default.


def get_speaker() -> int:
    return _current_speaker


def set_speaker(speaker: int) -> bool:
    """Sets active voice, if it is in the list. True — success."""
    global _current_speaker
    if any(v["id"] == speaker for v in VOICES):
        _current_speaker = speaker
        return True
    return False


def _piper_bin() -> str:
    """Path to the piper executable (in the same venv as current python)."""
    cand = os.path.join(os.path.dirname(sys.executable), "piper")
    return cand if os.path.exists(cand) else "piper"


# Stresses: the model is trained on text with stresses (combining acute U+0301 after
# vowel). Without them, stress is random («ціка́вого» sounds incorrect). We place
# stresses via ukrainian-word-stress. Stressifier is loaded lazily (has a dictionary).
_stressify = None
_stress_ready = False


def _get_stressify():
    global _stressify, _stress_ready
    if _stress_ready:
        return _stressify
    _stress_ready = True
    try:
        from ukrainian_word_stress import Stressifier, StressSymbol
        _stressify = Stressifier(stress_symbol=StressSymbol.CombiningAcuteAccent)
    except Exception:  # noqa: BLE001 — without stresses dubbing still works
        log.warning("ukrainian-word-stress недоступний — озвучка без наголосів", exc_info=True)
        _stressify = None
    return _stressify


def is_available() -> bool:
    """Whether the Piper model is available (without it dubbing is impossible)."""
    return os.path.exists(_MODEL)


def _clean(text: str) -> str:
    # Markup, links and emojis — common cleanup for all providers
    # (tts_text): bare «https://youtu.be/…» the model reads character by character, and one
    # response with three links turns into a minute of babbling.
    text = tts_text.clean_for_speech(text)
    # Latin → Ukrainian pronunciation (Raspberry Pi → респбері пай).
    # Exactly HERE, BEFORE lower(): the rule of abbreviations (GPIO → джі-пі-ай-о)
    # distinguishes words exactly by uppercase letters.
    text = voice_latin.adapt(text)
    # ⚠️ lowercase — otherwise uppercase Cyrillic letters drop out (not in phoneme-map)
    text = text.lower()[:1000]
    # Stresses (correct Ukrainian pronunciation)
    stressify = _get_stressify()
    if stressify:
        try:
            text = stressify(text)
        except Exception:  # noqa: BLE001 — failed to place stress → we will dub as is
            pass
    return text


def synthesize(text: str, speaker: int | None = None, speed: float = 1.0) -> bytes:
    """
    Dubs Ukrainian text with neural Piper voice. speaker — voice index
    (None → active), speed — rate (1.0 normal, 2.0 twice as fast).
    Returns WAV-bytes. Throws exception on error (endpoint → 503, frontend
    will fall back to browser voice).
    """
    if not is_available():
        raise RuntimeError("Piper-модель не знайдена")
    clean = _clean(text)
    if not clean:
        raise RuntimeError("Порожній текст для озвучки")

    spk = speaker if speaker is not None else _current_speaker
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        out_path = f.name
    try:
        # length-scale = 1/speed: parameter sets phoneme LENGTH, not speed.
        #
        # Growth is non-linear: measured on three sentences, that 0.667 gives ~1.4×,
        # and 0.5 — ~1.7× instead of exactly 1.5× and 2×. This is the behavior of the model itself, not
        # the wrapper (verified by calling piper directly). Tweaking --sentence-silence
        # is useless: from 0.2 to 0.0 recording came out LONGER, i.e., parameter does not work here.
        scale = 1.0 / min(MAX_SPEED, max(MIN_SPEED, speed or 1.0))
        proc = subprocess.run(
            [_piper_bin(), "--model", _MODEL, "--speaker", str(spk),
             "--length-scale", f"{scale:.3f}", "--output_file", out_path],
            input=clean.encode("utf-8"),
            capture_output=True, timeout=30,
        )
        if proc.returncode != 0:
            raise RuntimeError("Piper помилка: " + proc.stderr.decode("utf-8", "replace")[:200])
        with open(out_path, "rb") as rf:
            data = rf.read()
        if not data:
            raise RuntimeError("Piper повернув порожнє аудіо")
        return data
    finally:
        try:
            os.unlink(out_path)
        except OSError:
            pass
