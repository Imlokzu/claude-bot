"""
Живий тест розпізнавання української через Regolo (faster-whisper-large-v3).

Свідомо НЕ мок: перевіряє те, що не перевірить жоден мок — що ключ робочий,
що модель приймає наше аудіо і що з нього виходить осмислена українська.

Пропускається (skip, не fail), якщо:
  * немає env REGOLO_ASR_API_KEY — на CI і в чужих клонах ключа не буде;
  * немає мережі, щоб завантажити зразок мовлення.

Запуск:  REGOLO_ASR_API_KEY=... .venv/bin/python -m pytest tests/test_asr_regolo_live.py -s
"""

from __future__ import annotations

import asyncio
import os
import unittest
import urllib.error
import urllib.request

import app_config as cfg
import asr_regolo

# Зразок української мови з Вікісховища (CIA World Factbook, ~90 КБ, ogg/vorbis).
# Беремо зовнішній файл, щоб не тягнути бінарник у репозиторій.
SAMPLE_URL = (
    "https://upload.wikimedia.org/wikipedia/commons/7/7d/"
    "Spoken_sample_of_Ukrainian%2C_from_the_CIA_World_Factbook.ogg"
)
# Вікімедіа відхиляє запити без User-Agent (403)
SAMPLE_UA = "KlodBot/1.0 (ASR self-test)"


def _fetch_sample() -> bytes:
    req = urllib.request.Request(SAMPLE_URL, headers={"User-Agent": SAMPLE_UA})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()


class RegoloAsrLiveTests(unittest.TestCase):
    def setUp(self) -> None:
        if not os.environ.get("REGOLO_ASR_API_KEY", "").strip():
            self.skipTest("немає REGOLO_ASR_API_KEY — живий ASR не перевіряємо")
        if not asr_regolo.is_available():
            self.skipTest(f"ASR вимкнений у конфізі (provider={cfg.ASR_PROVIDER})")

    def test_transcribes_ukrainian_speech(self) -> None:
        try:
            audio = _fetch_sample()
        except (urllib.error.URLError, OSError) as exc:
            self.skipTest(f"не вдалося завантажити зразок мовлення: {exc}")

        self.assertGreater(len(audio), 10_000, "зразок підозріло малий")

        text = asyncio.run(asr_regolo.transcribe(audio, "uk-sample.ogg", "application/ogg"))
        print("\nRegolo (" + cfg.REGOLO_ASR_MODEL + ") розпізнав:\n" + text + "\n")

        self.assertTrue(text.strip(), "Regolo повернув порожній текст")
        # Кирилиця — мінімальний доказ, що це українська, а не англійська калька
        self.assertTrue(
            any("а" <= ch.lower() <= "я" or ch in "іїєґ" for ch in text),
            f"у відповіді немає кирилиці: {text[:120]!r}",
        )


if __name__ == "__main__":
    unittest.main()
