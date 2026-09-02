"""
«Клод Бот» — живий УКРАЇНСЬКИЙ голос через Piper TTS (нейронний, локальний, ШІ).

MiMo TTS (Xiaomi) не має українського голосу — читав кирилицю китайським/італійським
жаргоном (перевірено round-trip через Whisper). Браузерний speechSynthesis — роботичний.
Piper — нейронна українська модель `uk_UA-ukrainian_tts-medium`: природний голос,
на-пристрої, безкоштовно, без зовнішніх сервісів (приватність).

Потік: текст → (lowercase + чистка markdown) → piper CLI → 22kHz wav.

⚠️ Модель НЕ має великих літер у phoneme-мапі (П/К/Б... випадають) → текст ПЕРЕД
синтезом переводимо в НИЖНІЙ регістр (на вимову це не впливає).
"""

from __future__ import annotations

import logging
import os
import re
import subprocess
import sys
import tempfile

import voice_latin

log = logging.getLogger("virtual_bot.tts")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
_MODEL = os.environ.get(
    "PIPER_MODEL",
    os.path.join(BASE_DIR, "voices", "uk_UA-ukrainian_tts-medium.onnx"),
)

# Голоси всередині моделі (multi-speaker). lada звучить по-дитячому — за
# замовчуванням беремо дорослий. Порядок/назви — з speaker_id_map конфіга.
VOICES = [
    {"id": 1, "name": "Микита", "hint": "чоловічий, дорослий"},
    {"id": 2, "name": "Тетяна", "hint": "жіночий, дорослий"},
    {"id": 0, "name": "Лада", "hint": "жіночий, молодший"},
]
_DEFAULT_SPEAKER = int(os.environ.get("PIPER_SPEAKER", "1"))
_current_speaker = _DEFAULT_SPEAKER

# Темп мовлення. Piper керує ним через --length-scale — це ДОВЖИНА фонеми,
# тобто величина, ОБЕРНЕНА до швидкості: 0.5 = удвічі швидше. Тому speed із
# запиту перевертаємо, а не передаємо як є.
#
# Робимо це синтезом, а не playbackRate у плеєрі: розгін готового аудіо
# розтягує спектр і додає «булькання», а модель на меншому length-scale
# просто говорить швидше, лишаючись собою.
SPEEDS = [1.0, 1.5, 2.0]
MIN_SPEED = 0.5
MAX_SPEED = 3.0                 # вище українська вимова розсипається

# Заміряно round-trip через Whisper: на 1.5× текст розпізнається дослівно, на
# 2× вимова вже пливе («Raspberry Pi» → «SbriPy»). Тому 2.0 лишається у списку
# як усвідомлений вибір користувача, а не як безпечний дефолт.


def get_speaker() -> int:
    return _current_speaker


def set_speaker(speaker: int) -> bool:
    """Ставить активний голос, якщо він у списку. True — успіх."""
    global _current_speaker
    if any(v["id"] == speaker for v in VOICES):
        _current_speaker = speaker
        return True
    return False


def _piper_bin() -> str:
    """Шлях до виконуваного piper (у тому ж venv, що й поточний python)."""
    cand = os.path.join(os.path.dirname(sys.executable), "piper")
    return cand if os.path.exists(cand) else "piper"


# Наголоси: модель навчена на тексті з наголосами (combining acute U+0301 після
# голосної). Без них наголос випадковий («ціка́вого» звучить неправильно). Ставимо
# наголоси через ukrainian-word-stress. Stressifier вантажимо ліниво (має словник).
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
    except Exception:  # noqa: BLE001 — без наголосів озвучка все одно працює
        log.warning("ukrainian-word-stress недоступний — озвучка без наголосів", exc_info=True)
        _stressify = None
    return _stressify


def is_available() -> bool:
    """Чи є модель Piper (без неї озвучка неможлива)."""
    return os.path.exists(_MODEL)


_MD_RE = re.compile(r"[*_`#>\[\]]+")
_EMOJI_RE = re.compile(
    "[\U0001F000-\U0001FAFF\U00002600-\U000027BF\U0001F1E6-\U0001F1FF←-⇿⌀-⏿]",
    flags=re.UNICODE,
)


def _clean(text: str) -> str:
    text = _MD_RE.sub("", text)
    text = _EMOJI_RE.sub("", text)         # емодзі голосом не читаємо
    text = re.sub(r"\s+", " ", text).strip()
    # Латиниця → українська вимова (Raspberry Pi → респбері пай).
    # Саме ТУТ, ДО lower(): правило абревіатур (GPIO → джі-пі-ай-о)
    # розрізняє слова саме за великими літерами.
    text = voice_latin.adapt(text)
    # ⚠️ нижній регістр — інакше великі кириличні літери випадають (нема у phoneme-мапі)
    text = text.lower()[:1000]
    # Наголоси (правильна українська вимова)
    stressify = _get_stressify()
    if stressify:
        try:
            text = stressify(text)
        except Exception:  # noqa: BLE001 — не вдалось наголосити → озвучимо як є
            pass
    return text


def synthesize(text: str, speaker: int | None = None, speed: float = 1.0) -> bytes:
    """
    Озвучує український текст нейронним голосом Piper. speaker — індекс голосу
    (None → активний), speed — темп (1.0 звичайний, 2.0 удвічі швидше).
    Повертає WAV-байти. Кидає виняток на помилці (ендпоінт → 503, фронтенд
    відкотиться на браузерний голос).
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
        # length-scale = 1/speed: параметр задає ДОВЖИНУ фонеми, не швидкість.
        #
        # Приріст нелінійний: заміряно на трьох реченнях, що 0.667 дає ~1.4×,
        # а 0.5 — ~1.7× замість рівно 1.5× і 2×. Це поведінка самої моделі, не
        # обгортки (перевірено викликом piper напряму). Крутити --sentence-silence
        # марно: з 0.2 на 0.0 запис виходив ДОВШИМ, тобто параметр тут не діє.
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
