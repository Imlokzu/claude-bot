from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

import asr_whisper


class LanguageChoiceTests(unittest.TestCase):
    """
    Вибір мови перед розпізнаванням. Моделі тут не вантажимо — важлива саме
    логіка обмеження, а не акустика.
    """

    def _detect(self, probs: list[tuple[str, float]], languages: list[str]):
        """Підмінює маленьку модель фальшивим визначником мови."""
        model = MagicMock()
        model.detect_language.return_value = (probs[0][0], probs[0][1], probs)
        return patch.multiple(
            asr_whisper,
            _LANGUAGES=languages,
            _PRIMARY_LANGUAGE=languages[0],
            _get_partial_model=MagicMock(return_value=model),
        ), model

    def test_single_language_skips_detection_entirely(self) -> None:
        """Одна мова — швидкий шлях: заміряно 2.65с проти 3.17с із визначенням."""
        ctx, model = self._detect([("en", 0.9), ("uk", 0.1)], ["uk"])
        with ctx, patch("faster_whisper.audio.decode_audio", MagicMock()):
            self.assertEqual(asr_whisper._detect_language("/tmp/x.wav"), "uk")
        model.detect_language.assert_not_called()

    def test_language_outside_the_list_cannot_win(self) -> None:
        """
        Головне у двомовному режимі: польська може бути найімовірнішою для
        моделі, але якщо її немає в `asr.languages` — вибрати її нема як.
        """
        ctx, _ = self._detect([("pl", 0.88), ("uk", 0.07), ("en", 0.03)], ["uk", "en"])
        with ctx, patch("faster_whisper.audio.decode_audio", MagicMock()):
            self.assertEqual(asr_whisper._detect_language("/tmp/x.wav"), "uk")

    def test_allowed_language_with_best_probability_wins(self) -> None:
        ctx, _ = self._detect([("en", 0.91), ("uk", 0.05)], ["uk", "en"])
        with ctx, patch("faster_whisper.audio.decode_audio", MagicMock()):
            self.assertEqual(asr_whisper._detect_language("/tmp/x.wav"), "en")

    def test_detection_failure_falls_back_to_primary(self) -> None:
        """Не вгадали мову — це не причина не розпізнати аудіо взагалі."""
        ctx, model = self._detect([("en", 0.9), ("uk", 0.1)], ["uk", "en"])
        model.detect_language.side_effect = RuntimeError("немає моделі")
        with ctx, patch("faster_whisper.audio.decode_audio", MagicMock()):
            self.assertEqual(asr_whisper._detect_language("/tmp/x.wav"), "uk")

    def test_no_allowed_language_in_probs_falls_back_to_primary(self) -> None:
        ctx, _ = self._detect([("pl", 0.9), ("ru", 0.1)], ["uk", "en"])
        with ctx, patch("faster_whisper.audio.decode_audio", MagicMock()):
            self.assertEqual(asr_whisper._detect_language("/tmp/x.wav"), "uk")


class LanguageConfigTests(unittest.TestCase):
    def test_config_exposes_languages_and_regolo_takes_the_first(self) -> None:
        """Regolo приймає РІВНО одну мову, тож йому дістається основна."""
        import app_config as cfg
        self.assertGreaterEqual(len(cfg.ASR_LANGUAGES), 1)
        self.assertEqual(cfg.REGOLO_ASR_LANGUAGE, cfg.ASR_LANGUAGES[0])


if __name__ == "__main__":
    unittest.main()
