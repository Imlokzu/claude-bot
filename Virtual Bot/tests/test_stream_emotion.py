from __future__ import annotations

import unittest

from emotions import StreamTagFilter, extract_emotion


class StreamTagFilterTests(unittest.TestCase):
    """Тег [емоція:…] не має світитись у чаті під час друку відповіді."""

    def _run(self, chunks: list[str]) -> tuple[str, list[str]]:
        flt = StreamTagFilter()
        visible, found = "", []
        for chunk in chunks:
            text, emotion = flt.feed(chunk)
            visible += text
            if emotion:
                found.append(emotion)
        return visible + flt.flush(), found

    def test_tag_split_across_chunks_is_removed(self) -> None:
        visible, found = self._run(["[емо", "ція:sear", "ching] Зара", "з пошукаю"])
        self.assertNotIn("[", visible)
        self.assertEqual(visible.strip(), "Зараз пошукаю")
        self.assertEqual(found, ["searching"])

    def test_emotion_arrives_before_the_text(self) -> None:
        flt = StreamTagFilter()
        text, emotion = flt.feed("[емоція:web] шукаю")
        self.assertEqual(emotion, "web")  # обличчя реагує вже на першому чанку
        self.assertEqual(text.strip(), "шукаю")

    def test_stream_matches_final_reply(self) -> None:
        """Потік і фінальна відповідь мають збігатися — інакше текст «перестрибне»."""
        raw = "[емоція:searching] Зараз пошукаю 🦀 [емоція:sad] ой"
        visible, _ = self._run([raw[:6], raw[6:20], raw[20:]])
        clean, _ = extract_emotion(raw)
        self.assertEqual(visible.strip(), clean)

    def test_plain_brackets_are_kept(self) -> None:
        visible, found = self._run(["масив a[0] і b[1] тут"])
        self.assertEqual(visible, "масив a[0] і b[1] тут")
        self.assertEqual(found, [])

    def test_long_bracket_text_is_not_held_forever(self) -> None:
        """Довгий фрагмент після '[' точно не тег — не має зависати в буфері."""
        long_text = "[" + "x" * 80
        visible, _ = self._run([long_text])
        self.assertEqual(visible, long_text)


if __name__ == "__main__":
    unittest.main()
