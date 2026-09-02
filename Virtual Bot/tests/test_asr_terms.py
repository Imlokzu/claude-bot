from __future__ import annotations

import unittest
from unittest.mock import patch

import asr_terms
import voice_latin


class AsrTermsTests(unittest.TestCase):
    def _rules(self, aliases: dict[str, list[str]]):
        """Правила з довільного словника — не залежимо від живого config.yaml."""
        return patch.object(asr_terms, "_RULES", asr_terms._compile(aliases))

    def test_different_pronunciations_collapse_to_one_name(self) -> None:
        """«джемінай» і «геміні» — одна модель, у тексті мусить бути одне слово."""
        with self._rules({"Gemini": ["джемінай", "геміні"]}):
            self.assertEqual(asr_terms.normalize("Спитай Джемінай про це"), "Спитай Gemini про це")
            self.assertEqual(asr_terms.normalize("А Геміні що каже"), "А Gemini що каже")

    def test_misheard_short_name_is_repaired(self) -> None:
        """Короткі назви підказки не витягують: «Квен» стабільно чується «кван»."""
        with self._rules({"Qwen": ["квен", "кван"]}):
            self.assertEqual(asr_terms.normalize("перемкнись на кван"), "перемкнись на Qwen")

    def test_digit_and_hyphen_neighbours_still_match(self) -> None:
        """Whisper віддає версію дефісами: «ГЛМ-5-3» мусить збігтись цілим словом."""
        with self._rules({"GLM": ["глм"]}):
            self.assertEqual(asr_terms.normalize("Постав ГЛМ-5-3"), "Постав GLM-5-3")

    def test_longer_variant_wins_over_shorter(self) -> None:
        """Багатослівна вимова не має розриватись однослівним збігом."""
        with self._rules({"GLM": ["глм", "ге ел ем"], "Nemotron": ["ем"]}):
            self.assertEqual(asr_terms.normalize("постав ге ел ем"), "постав GLM")

    def test_substring_inside_another_word_is_not_touched(self) -> None:
        """Заміна лише цілими словами — інакше вона нівечила б звичайний текст."""
        with self._rules({"Grok": ["грок"]}):
            self.assertEqual(asr_terms.normalize("грокає і грокнув"), "грокає і грокнув")

    def test_empty_input_and_empty_rules_are_safe(self) -> None:
        with self._rules({}):
            self.assertEqual(asr_terms.normalize("текст без правил"), "текст без правил")
        with self._rules({"Qwen": ["квен"]}):
            self.assertEqual(asr_terms.normalize(""), "")

    def test_canonical_names_are_pronounceable_by_ukrainian_tts(self) -> None:
        """
        Канон іде латиницею, тож TTS мусить знати його вимову — інакше
        нормалізація ASR ламала б озвучення тієї самої назви.
        """
        self.assertEqual(voice_latin.adapt("Gemini"), "джемінай")
        self.assertEqual(voice_latin.adapt("Qwen"), "квен")
        self.assertEqual(voice_latin.adapt("GLM"), "ге ел ем")
        self.assertEqual(voice_latin.adapt("DeepSeek"), "діпсік")


if __name__ == "__main__":
    unittest.main()
