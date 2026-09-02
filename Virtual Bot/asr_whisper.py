"""
«Клод Бот» — надійне розпізнавання української мови через Whisper (локально, ШІ).

Браузерний webkitSpeechRecognition виявився ненадійним (хмара Google часто віддає
«no-speech»), а MiMo ASR погано знає українську. Whisper (faster-whisper, CPU
int8) розпізнає українську ЧУДОВО, локально, без ключів і зовнішніх сервісів.

Потік: браузер (MediaRecorder, webm/opus) → /api/asr → ffmpeg у 16kHz mono wav →
faster-whisper → український текст.

Модель вантажиться ЛІНИВО (при першому запиті) і кешується в памʼяті процесу.
Модель і режим виконання задаються у config.yaml (`asr.local_model` тощо) або
через env `WHISPER_MODEL` / `WHISPER_DEVICE` / `WHISPER_COMPUTE_TYPE`.
"""

from __future__ import annotations

import logging
import os
import platform
import subprocess
import tempfile
import threading

import app_config as cfg

log = logging.getLogger("virtual_bot.asr")

_MODEL_NAME = os.environ.get("WHISPER_MODEL", cfg.ASR_LOCAL_MODEL)
_DEVICE = os.environ.get("WHISPER_DEVICE", cfg.ASR_LOCAL_DEVICE).casefold()
_BEAM_SIZE = max(1, cfg.ASR_LOCAL_BEAM_SIZE)
# Модель живих проміжних результатів: поки ти ще говориш, текст рахує вона.
_PARTIAL_MODEL_NAME = os.environ.get("WHISPER_PARTIAL_MODEL", cfg.ASR_PARTIAL_MODEL)
# Словник підказок (`asr.hotwords`): без нього Whisper вгадує назви навмання —
# «Клод Код» ставав «клод-код», «Пайпер» — «Piper», «у гіт» — «угід». Терміни
# йдуть у той самий слот попереднього контексту, що й initial_prompt, тому
# initial_prompt тут НЕ ставимо: faster-whisper тоді тихо викине hotwords.
_HOTWORDS = os.environ.get("WHISPER_HOTWORDS", cfg.ASR_HOTWORDS).strip()
# Мови розпізнавання (`asr.languages`). Перша — основна: нею йдуть чорновики й
# нею ж усе працює, коли мова одна. Кілька мов = визначаємо мову перед
# розпізнаванням, АЛЕ вибір обмежений цим списком, тож зіскочити на польську
# чи російську фізично нема куди.
_LANGUAGES = [
    stripped
    for stripped in (
        code.strip()
        for code in os.environ.get(
            "WHISPER_LANGUAGES", ",".join(cfg.ASR_LANGUAGES)
        ).casefold().split(",")
    )
    if stripped
] or ["uk"]
_PRIMARY_LANGUAGE = _LANGUAGES[0]


def _threads() -> int:
    """
    Скільки ядер віддати ctranslate2.

    За замовчуванням він бере далеко не всі, і на M2 Pro та сама фраза
    рахувалась 5.6с замість 4.1с. 0 у конфізі = «за кількістю ядер».
    """
    configured = int(getattr(cfg, "ASR_LOCAL_THREADS", 0) or 0)
    if configured > 0:
        return configured
    return max(1, os.cpu_count() or 4)


def _compute_type() -> str:
    """
    Тип обчислень. На Apple Silicon int8 ПОВІЛЬНІШИЙ за float32 (заміряно:
    4.1с проти 2.8с на тій самій фразі) — у ctranslate2 там немає швидких
    int8-ядер, а float32 іде через Accelerate. Тому на arm64 без явного
    налаштування беремо float32; на решті лишається старий int8.
    """
    explicit = os.environ.get("WHISPER_COMPUTE_TYPE")
    if explicit:
        return explicit
    configured = (cfg.ASR_LOCAL_COMPUTE_TYPE or "").strip()
    if configured and configured != "int8":
        return configured
    if platform.machine().casefold() in ("arm64", "aarch64"):
        return "float32"
    return configured or "int8"


_COMPUTE_TYPE = _compute_type()
_model = None
_partial_model = None
_model_lock = threading.Lock()
_partial_lock = threading.Lock()


def is_available() -> bool:
    """Чи можна розпізнавати (faster-whisper імпортується)."""
    try:
        import faster_whisper  # noqa: F401
        return True
    except Exception:  # noqa: BLE001
        return False


def info() -> dict[str, str | int]:
    """Публічна діагностика без розкриття локальних шляхів чи секретів."""
    return {
        "model": _MODEL_NAME,
        "device": _DEVICE,
        "compute_type": _COMPUTE_TYPE,
        "beam_size": _BEAM_SIZE,
        "threads": _threads(),
        "partial_model": _PARTIAL_MODEL_NAME if cfg.ASR_PARTIALS_ENABLED else "",
        "hotwords": len([term for term in _HOTWORDS.split(",") if term.strip()]),
        "languages": ",".join(_LANGUAGES),
    }


_warming = False


def warm() -> None:
    """
    Прогріває моделі у фоні. Викликається на старті застосунку: без цього
    ПЕРШЕ розпізнавання чекало ще ~5с на завантаження моделі понад сам декод.
    """
    global _warming
    if _warming or not is_available():
        return
    _warming = True

    def _load():
        global _warming
        try:
            _get_model()
            if cfg.ASR_PARTIALS_ENABLED:
                _get_partial_model()
        except Exception:  # noqa: BLE001
            log.warning("Whisper: не вдалося прогріти модель", exc_info=True)
        finally:
            _warming = False

    threading.Thread(target=_load, daemon=True).start()


def _build_model(name: str):
    """Одна модель faster-whisper із нашими налаштуваннями швидкості."""
    from faster_whisper import WhisperModel
    log.info(
        "Whisper: завантажую «%s» (%s, %s, %d потоків; перший раз може качати)…",
        name, _DEVICE, _COMPUTE_TYPE, _threads(),
    )
    model = WhisperModel(
        name, device=_DEVICE, compute_type=_COMPUTE_TYPE, cpu_threads=_threads(),
    )
    log.info("Whisper: модель «%s» готова", name)
    return model


def _get_model():
    """Лінива одноразова ініціалізація головної моделі (потокобезпечно)."""
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                _model = _build_model(_MODEL_NAME)
    return _model


def _get_partial_model():
    """
    Модель для живих проміжних результатів. Окрема й МЕНША: поки ти говориш,
    важлива швидкість (заміряно: small — 0.74с проти 2.8с у large-v3-turbo),
    а точність добере остаточне розпізнавання головною моделлю.

    Якщо це та сама назва, що й головна — другої моделі в память НЕ вантажимо.
    """
    global _partial_model
    if _PARTIAL_MODEL_NAME == _MODEL_NAME:
        return _get_model()
    if _partial_model is None:
        with _partial_lock:
            if _partial_model is None:
                _partial_model = _build_model(_PARTIAL_MODEL_NAME)
    return _partial_model


def _detect_language(wav_path: str) -> str:
    """
    Яка з дозволених мов звучить у файлі.

    Визначає МАЛЕНЬКА модель (та сама, що рахує чорновики): заміряно 0.48с і
    впевненість 0.98 проти 2.98с у large-v3-turbo при тій самій відповіді —
    визначити мову значно легше, ніж розпізнати слова.

    Беремо argmax ЛИШЕ серед `_LANGUAGES`, а не глобальний: щойно польської й
    російської немає в кандидатах, невиразна українська фраза не має куди
    зіскочити. Помилка визначення не має ламати розпізнавання — тоді просто
    працюємо основною мовою.
    """
    if len(_LANGUAGES) < 2:
        return _PRIMARY_LANGUAGE
    try:
        from faster_whisper.audio import decode_audio
        audio = decode_audio(wav_path, sampling_rate=16000)
        _lang, _prob, probs = _get_partial_model().detect_language(audio=audio)
        allowed = [(code, prob) for code, prob in probs if code in _LANGUAGES]
        if not allowed:
            return _PRIMARY_LANGUAGE
        code, prob = max(allowed, key=lambda pair: pair[1])
        log.info("Whisper: мова «%s» (%.2f) з %s", code, prob, _LANGUAGES)
        return code
    except Exception:  # noqa: BLE001 — не вгадали мову, але аудіо все одно розпізнаємо
        log.warning("Whisper: не вдалося визначити мову, беру «%s»", _PRIMARY_LANGUAGE)
        return _PRIMARY_LANGUAGE


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
    return _run(_get_model(), audio_bytes, suffix, _BEAM_SIZE, detect=True)


def transcribe_partial(audio_bytes: bytes, suffix: str = ".webm") -> str:
    """
    Проміжне розпізнавання «на льоту»: те саме, але швидкою моделлю і
    beam_size=1. Викликається, поки людина ще говорить, тож текст може
    змінитись — остаточний рахує transcribe().
    """
    # Мову тут НЕ визначаємо: чорновик рахується кожні ~1.2с, і +0.5с на кожен
    # виклик зʼїли б увесь сенс живого тексту. Остаточне розпізнавання визначить.
    return _run(_get_partial_model(), audio_bytes, suffix, 1, detect=False)


def _run(model, audio_bytes: bytes, suffix: str, beam_size: int, detect: bool) -> str:
    """Спільне тіло розпізнавання: конвертація → декод → прибирання файлу."""
    wav_path = _to_wav16(audio_bytes, suffix)
    try:
        # Мову передаємо ЗАВЖДИ явно. language=None (авто) коштує +2.8с, бо
        # велика модель робить власний прохід визначення — саме те, від чого
        # ми й тікаємо, віддаючи визначення маленькій моделі.
        language = _detect_language(wav_path) if detect else _PRIMARY_LANGUAGE
        # ⚠️ БЕЗ vad_filter: на тихішому мікрофоні VAD видаляв УСЮ мову (лог:
        # «VAD filter removed 00:03.840 of audio» → порожній текст). Для коротких
        # реплік компаньйона фільтр не потрібен — Whisper і так дає порожньо на тиші.
        segments, _info = model.transcribe(
            wav_path,
            language=language,
            beam_size=beam_size,
            hotwords=_HOTWORDS or None,
        )
        text = " ".join(seg.text for seg in segments).strip()
        return text
    finally:
        try:
            os.unlink(wav_path)
        except OSError:
            pass
