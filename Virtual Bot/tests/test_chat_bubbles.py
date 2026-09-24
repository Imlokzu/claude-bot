"""
Bubble and reaction tags must never reach a human.

The model writes `[[msg]]` between messages and `[react:👍]` to react. If
either slips through, the chat shows raw markup, the voice reads "react
colon", and the device screen prints brackets.
"""

import unittest

import chat_bubbles
from chat_bubbles import BubbleStream, is_emoji, plain, shape, trim_open_tag


def run_stream(chunks: list[str]) -> tuple[list[dict], BubbleStream]:
    stream = BubbleStream()
    events: list[dict] = []
    for chunk in chunks:
        events.extend(stream.feed(chunk))
    events.extend(stream.flush())
    return events, stream


def bubbles_from(events: list[dict]) -> list[str]:
    out = [""]
    for event in events:
        if event["type"] == "break":
            out.append("")
        elif event["type"] == "delta":
            out[-1] += event["chunk"]
    return [b.strip() for b in out if b.strip()]


class ShapeTests(unittest.TestCase):
    def test_marker_splits_into_bubbles(self) -> None:
        bubbles, reaction = shape("Ок, гляну.[[msg]] Знайшов три варіанти.\n[[msg]]\nПерший найкращий.")
        self.assertEqual(bubbles, ["Ок, гляну.", "Знайшов три варіанти.", "Перший найкращий."])
        self.assertIsNone(reaction)

    def test_models_vary_the_tag_spelling(self) -> None:
        self.assertEqual(shape("a [[ MSG ]] b")[0], ["a", "b"])
        self.assertEqual(shape("hi [React: 👍]")[1], "👍")

    def test_reaction_only_reply_has_no_text_bubble(self) -> None:
        # "thanks" deserves a thumbs up, not an empty grey bubble.
        self.assertEqual(shape("[react:👍]"), ([], "👍"))
        self.assertEqual(plain("[react:👍]"), "")

    def test_words_are_not_reactions(self) -> None:
        self.assertEqual(shape("[react:ok] Добре"), (["Добре"], None))

    def test_emoji_with_modifiers_is_one_reaction(self) -> None:
        for emoji in ("❤️", "👍🏽", "👨‍💻", "🇺🇦", "🔥"):
            self.assertTrue(is_emoji(emoji), emoji)
        for word in ("ok", "1", ":)", "", "👍👍👍👍👍👍👍👍👍"):
            self.assertFalse(is_emoji(word), word)

    def test_plain_joins_bubbles_for_voice_and_screen(self) -> None:
        self.assertEqual(plain("Раз[[msg]]Два [react:🔥]"), "Раз\n\nДва")

    def test_trim_open_tag_hides_half_written_markers(self) -> None:
        self.assertEqual(trim_open_tag("Зараз гляну [[ms"), "Зараз гляну ")
        self.assertEqual(trim_open_tag("Ціна [1] у тексті"), "Ціна [1] у тексті")


class StreamTests(unittest.TestCase):
    def test_marker_split_across_chunks(self) -> None:
        events, stream = run_stream(["Ок, гляну. [", "[m", "sg]] Знайшов."])
        self.assertEqual(bubbles_from(events), ["Ок, гляну.", "Знайшов."])
        self.assertEqual(stream.text_bubbles(), ["Ок, гляну.", "Знайшов."])
        self.assertNotIn("[", "".join(e.get("chunk", "") for e in events))

    def test_reaction_is_an_event_not_text(self) -> None:
        events, stream = run_stream(["[rea", "ct:👍] Дякую!"])
        self.assertIn({"type": "reaction", "emoji": "👍"}, events)
        self.assertEqual(bubbles_from(events), ["Дякую!"])
        self.assertEqual(stream.reaction, "👍")

    def test_trailing_marker_does_not_open_an_empty_bubble(self) -> None:
        events, _ = run_stream(["Готово.[[msg]]", "[react:✅]"])
        self.assertEqual([e["type"] for e in events].count("break"), 0)
        self.assertEqual(bubbles_from(events), ["Готово."])

    def test_plain_brackets_are_released(self) -> None:
        # A citation "[1]" or a markdown link must not be swallowed.
        events, _ = run_stream(["Див. [1] і [лінк](http://x)"])
        self.assertEqual(bubbles_from(events), ["Див. [1] і [лінк](http://x)"])

    def test_stream_matches_shape(self) -> None:
        raw = "Секунду, шукаю.[[msg]]Є три рейси.[[msg]]Найдешевший о 9:10 [react:✈️]"
        events, _ = run_stream([raw[i:i + 3] for i in range(0, len(raw), 3)])
        self.assertEqual(bubbles_from(events), shape(raw)[0])

    def test_hold_is_bounded(self) -> None:
        long_bracket = "[" + "x" * (chat_bubbles._MAX_HOLD + 5)
        events = BubbleStream().feed(long_bracket)
        self.assertEqual("".join(e["chunk"] for e in events), long_bracket)


if __name__ == "__main__":
    unittest.main()
