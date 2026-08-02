"""
Клод Бот — Voice Loop (Крок 3 з claude-bot-dev-order.md, підключений до OpenClaw)

Слухає мікрофон, розпізнає мовлення локально (faster-whisper), надсилає
текст у OpenClaw (`/v1/chat/completions` — памʼять, tool use, включно з
vision_check_camera, і сам Claude вже всередині), і озвучує відповідь.

Поки все на ноуті/i5 — мікрофон і колонки комп'ютера як тимчасовий "рот і
вуха", як і заплановано в dev-order.md.

Запуск:
    python voice_loop.py
Вихід: Ctrl+C
"""

from __future__ import annotations

import os
import pathlib
import queue
import sys

import numpy as np
import sounddevice as sd
import yaml
from faster_whisper import WhisperModel

from openclaw_client import OpenClawClient

CONFIG_PATH = pathlib.Path(__file__).parent / "config.yaml"


def load_config() -> dict:
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def validate_config(config: dict) -> None:
    """Перевіряє наявність обовʼязкових верхньорівневих ключів, інакше виходить із зрозумілим повідомленням."""
    required = ["openclaw", "listening", "stt", "tts"]
    missing = [key for key in required if not isinstance(config, dict) or key not in config]
    if missing:
        print(f"[!] У config.yaml бракує обовʼязкових ключів: {', '.join(missing)}")
        sys.exit(1)
    # Порожня секція в YAML (наприклад, `tts:` без підключів) дає None — тоді
    # звернення на кшталт config["tts"].get(...) впаде вже посеред циклу.
    # Краще впасти одразу зі зрозумілим повідомленням.
    not_mappings = [key for key in required if not isinstance(config[key], dict)]
    if not_mappings:
        print(f"[!] У config.yaml секції порожні або не є мапами: {', '.join(not_mappings)}")
        sys.exit(1)


def record_utterance(config: dict) -> np.ndarray:
    """Записує до тиші (RMS нижче порогу) або до max_utterance_s."""
    sr = config["listening"]["sample_rate"]
    channels = config["listening"]["channels"]
    silence_threshold = config["listening"]["silence_threshold"]
    silence_duration_s = config["listening"]["silence_duration_s"]
    max_s = config["listening"]["max_utterance_s"]

    block_s = 0.1
    block_size = int(sr * block_s)
    silence_blocks_needed = max(1, int(silence_duration_s / block_s))

    audio_chunks: list[np.ndarray] = []
    silent_blocks = 0
    speaking_started = False

    q: "queue.Queue[np.ndarray]" = queue.Queue()

    def callback(indata, frames, time_info, status):
        q.put(indata.copy())

    print("Слухаю…")
    with sd.InputStream(
        samplerate=sr, channels=channels, dtype="int16", blocksize=block_size, callback=callback
    ):
        total_blocks = 0
        max_blocks = int(max_s / block_s)
        while total_blocks < max_blocks:
            block = q.get()
            total_blocks += 1
            rms = float(np.sqrt(np.mean(block.astype(np.float32) ** 2)))

            if rms > silence_threshold:
                speaking_started = True
                silent_blocks = 0
                audio_chunks.append(block)
            elif speaking_started:
                silent_blocks += 1
                audio_chunks.append(block)
                if silent_blocks >= silence_blocks_needed:
                    break

    if not audio_chunks:
        return np.zeros(0, dtype=np.int16)

    return np.concatenate(audio_chunks, axis=0).flatten()


def transcribe(model: WhisperModel, audio: np.ndarray, language: str | None) -> str:
    try:
        audio_float = audio.astype(np.float32) / 32768.0
        segments, _info = model.transcribe(audio_float, language=language, beam_size=1)
        return " ".join(seg.text.strip() for seg in segments).strip()
    except Exception as e:  # noqa: BLE001 - збій Whisper не має валити цикл
        print(f"[!] Помилка розпізнавання мовлення: {e}")
        return ""


# Рушій pyttsx3: на macOS (драйвер nsss) повторний runAndWait() на тому самому
# рушії часто висне або мовчки нічого не озвучує — без виключення, тож
# try/except не рятує. Тому на darwin створюємо рушій на кожен виклик, а на
# інших платформах кешуємо (щоб не текли ресурси).
# Створення на кожен виклик на darwin не тече: pyttsx3.init() тримає рушії
# лише у weakref-кеші, сильних посилань між викликами speak() ми не лишаємо,
# тож старий рушій (разом з NSSpeechSynthesizer) звільняється одразу після
# speak(), і живим водночас є щонайбільше один рушій. Явного destroy() у
# mainline pyttsx3 немає (engine.stop() лише обриває поточне мовлення).
_tts_engine = None


def _new_tts_engine(config: dict):
    import pyttsx3

    engine = pyttsx3.init()
    engine.setProperty("rate", config["tts"].get("rate", 175))
    return engine


def _get_tts_engine(config: dict):
    global _tts_engine
    if sys.platform == "darwin":
        return _new_tts_engine(config)

    if _tts_engine is None:
        _tts_engine = _new_tts_engine(config)
    return _tts_engine


def speak(text: str, config: dict) -> None:
    global _tts_engine
    engine_name = config["tts"].get("engine", "pyttsx3")
    if engine_name != "pyttsx3":
        print(f"[!] TTS engine '{engine_name}' ще не підключено, виводжу текстом:")
        print(text)
        return

    try:
        engine = _get_tts_engine(config)
        engine.say(text)
        engine.runAndWait()
    except Exception as e:  # noqa: BLE001 - збій TTS не має валити цикл, показуємо текстом
        # Зламаний рушій не лишаємо в кеші — наступний виклик створить новий.
        _tts_engine = None
        print(f"[!] Помилка озвучення (TTS): {e}, виводжу текстом:")
        print(text)


def main() -> None:
    config = load_config()
    validate_config(config)

    print("Завантажую faster-whisper…")
    stt_cfg = config["stt"]
    model = WhisperModel(
        stt_cfg["model_size"],
        device=stt_cfg.get("device", "cpu"),
        compute_type=stt_cfg.get("compute_type", "int8"),
    )

    # Токен: env var OPENCLAW_TOKEN має пріоритет, інакше — значення з config.yaml.
    token = os.environ.get("OPENCLAW_TOKEN") or config["openclaw"].get("token")
    client = OpenClawClient(
        base_url=config["openclaw"]["base_url"],
        token=token,
        agent=config["openclaw"].get("agent", "openclaw/default"),
    )

    print("Клод Бот готовий. Говоріть після 'Слухаю…'. Ctrl+C для виходу.")
    try:
        while True:
            audio = record_utterance(config)
            if audio.size == 0:
                continue

            text = transcribe(model, audio, stt_cfg.get("language"))
            if not text:
                continue

            print(f"Ви: {text}")

            try:
                reply = client.send_message(text)
            except Exception as e:  # noqa: BLE001 - показуємо будь-яку мережеву/HTTP помилку користувачу
                print(f"[!] Помилка звʼязку з OpenClaw: {e}")
                continue

            print(f"Клод Бот: {reply}")
            speak(reply, config)
    except KeyboardInterrupt:
        print("\nВихід.")
        sys.exit(0)


if __name__ == "__main__":
    main()
