from __future__ import annotations

import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

import main


def _parse_sse(body: str) -> list[tuple[str, str]]:
    """SSE-текст → [(event, data), …]."""
    events: list[tuple[str, str]] = []
    name = None
    for line in body.splitlines():
        if line.startswith("event:"):
            name = line[len("event:"):].strip()
        elif line.startswith("data:") and name:
            events.append((name, line[len("data:"):].strip()))
            name = None
    return events


class ChatStreamEmotionTests(unittest.TestCase):
    """
    Наскрізна перевірка того, що бачить чат: тег [емоція:…] не має долітати
    до фронтенду в тексті, а сама емоція має приходити ДО кінця відповіді.
    """

    def _stream(self, chunks: list[str], reply: str, emotion: str = "searching"):
        async def fake_chat(message, history, emit=None):
            for chunk in chunks:
                await emit({"type": "delta", "chunk": chunk})
            return reply, emotion, "test", []

        with patch.object(main.brains, "chat", fake_chat):
            with TestClient(main.app) as client:
                resp = client.post(
                    "/api/chat",
                    json={"message": "привіт", "stream": True, "session_id": "test-stream"},
                )
        self.assertEqual(resp.status_code, 200)
        return _parse_sse(resp.text)

    def test_emotion_tag_never_reaches_the_chat(self) -> None:
        events = self._stream(
            ["[емоція:sear", "ching] Зараз ", "пошукаю"],
            reply="Зараз пошукаю",
        )
        deltas = "".join(data for name, data in events if name == "delta")
        self.assertNotIn("емоція", deltas)
        self.assertNotIn("[", deltas)

    def test_emotion_event_arrives_before_done(self) -> None:
        events = self._stream(["[емоція:web] шукаю"], reply="шукаю", emotion="web")
        names = [name for name, _ in events]
        self.assertIn("emotion", names)
        self.assertLess(names.index("emotion"), names.index("done"))

    def test_streamed_text_matches_final_reply(self) -> None:
        """Інакше фронтенд наприкінці підмінить текст і він «перестрибне»."""
        events = self._stream(
            ["[емоція:happy] Привіт", ", як справи?"],
            reply="Привіт, як справи?",
        )
        deltas = "".join(
            __import__("json").loads(data)["chunk"]
            for name, data in events
            if name == "delta"
        )
        self.assertEqual(deltas, "Привіт, як справи?")


if __name__ == "__main__":
    unittest.main()
