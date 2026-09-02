"""
Латиниця в українському голосі Piper.

Народилось із простого спостереження: модель `uk_UA-ukrainian_tts-medium` має
УКРАЇНСЬКУ фонемну мапу, тож «Raspberry Pi», «Python» і «GPIO» посеред речення
або зникали, або звучали як шум. Тест фіксує три рівні заміни (словник →
абревіатура → транслітерація) і — окремо — що ця заміна стоїть ДО lower(),
бо інакше правило абревіатур перестає їх бачити.
"""

from __future__ import annotations

import unittest

import piper_voice
import voice_latin


class KnownWordTests(unittest.TestCase):
    """Технічні слова беремо зі словника — вимовою, а не за буквами."""

    def test_multiword_phrase_wins_over_separate_words(self) -> None:
        # «raspberry pi» має лишитись цілим: розбите на два слова воно дало б
        # «респбері» + «пай» лише випадково, а для «wi-fi» збіг зник би зовсім.
        self.assertEqual(voice_latin.adapt("Raspberry Pi"), "респбері пай")
        self.assertEqual(voice_latin.adapt("Wi-Fi"), "вай фай")

    def test_english_spelling_does_not_leak_into_pronunciation(self) -> None:
        # Побуквенно «python» дало б «пітхон» — саме проти цього і є словник.
        self.assertEqual(voice_latin.adapt("Python"), "пайтон")
        self.assertEqual(voice_latin.adapt("Linux"), "лінукс")
        self.assertEqual(voice_latin.adapt("Claude"), "клод")

    def test_case_does_not_matter_for_lookup(self) -> None:
        self.assertEqual(voice_latin.adapt("PYTHON"), "пайтон")
        self.assertEqual(voice_latin.adapt("python"), "пайтон")


class AcronymTests(unittest.TestCase):
    """ВЕЛИКІ літери = абревіатура: читаємо по буквах."""

    def test_uppercase_acronym_is_spelled_out(self) -> None:
        self.assertEqual(voice_latin.adapt("GPIO"), "джі пі ай о")
        self.assertEqual(voice_latin.adapt("API"), "ей пі ай")

    def test_lowercase_same_letters_are_not_spelled(self) -> None:
        # «api» рядковими — це вже не абревіатура в тексті, а слово;
        # по буквах його читати не треба.
        self.assertNotEqual(voice_latin.adapt("api"), "ей пі ай")

    def test_long_uppercase_word_is_not_an_acronym(self) -> None:
        # Понад 5 літер великими — це радше крик, ніж абревіатура.
        self.assertNotIn(" ", voice_latin.adapt("RASPBERRYY"))


class TransliterationTests(unittest.TestCase):
    """Незнайомі слова — остання лінія: побуквенно, але з диграфами."""

    def test_unknown_word_becomes_cyrillic(self) -> None:
        out = voice_latin.adapt("unknownword")
        self.assertTrue(out)
        # Головна вимога: жодної латиниці не лишилось — саме вона й німа.
        self.assertFalse(any("a" <= c.lower() <= "z" for c in out))

    def test_digraphs_beat_single_letters(self) -> None:
        self.assertEqual(voice_latin.adapt("shop"), "шоп")
        self.assertEqual(voice_latin.adapt("chat"), "чат")


class UntouchedTextTests(unittest.TestCase):
    """Кирилиця, цифри й пунктуація лишаються як були."""

    def test_cyrillic_and_digits_survive(self) -> None:
        self.assertEqual(voice_latin.adapt("Привіт, 42!"), "Привіт, 42!")

    def test_empty_text_is_safe(self) -> None:
        self.assertEqual(voice_latin.adapt(""), "")

    def test_mixed_sentence_keeps_ukrainian_part(self) -> None:
        out = voice_latin.adapt("Він працює на Linux")
        self.assertTrue(out.startswith("Він працює на "))
        self.assertTrue(out.endswith("лінукс"))


class CleanPipelineTests(unittest.TestCase):
    """_clean має адаптувати латиницю ДО того, як зникне регістр."""

    def test_acronym_survives_lowercasing(self) -> None:
        # Якби adapt() стояв ПІСЛЯ lower(), «GPIO» вже було б «gpio» і
        # правило абревіатур його не впізнало б — перевіряємо саме порядок.
        self.assertIn("джі пі ай о", piper_voice._clean("Контакти GPIO"))

    def test_no_latin_reaches_the_synthesizer(self) -> None:
        cleaned = piper_voice._clean("Raspberry Pi працює на Linux з Python")
        self.assertFalse(any("a" <= c <= "z" for c in cleaned))
