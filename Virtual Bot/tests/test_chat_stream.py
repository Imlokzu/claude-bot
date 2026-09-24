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
        async def fake_chat(message, history, emit=None, **kwargs):
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


class StreamTimeoutTests(unittest.TestCase):
    """
    How long we tolerate silence between SSE chunks.

    The gateway sends nothing while its agent thinks or runs a tool — measured
    2026-09-20, a turn with one web search stayed quiet for 21s and then handed
    over the whole message at once. With a single blanket timeout of 35s every
    slower turn died with ReadTimeout, fell back to a non-streaming call and
    paid for the answer twice. Connecting must stay quick regardless: a gateway
    that is down has to be noticed at once, not after two minutes.
    """

    def _timeout_of(self, base: float, read: float | None):
        import asyncio

        import brains
        import httpx

        seen = {}

        class FakeClient:
            def __init__(self, *_args, **kwargs):
                seen["timeout"] = kwargs.get("timeout")

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_exc):
                return False

            def stream(self, *_args, **_kwargs):
                raise RuntimeError("stop here — only the timeout matters")

        with patch.object(httpx, "AsyncClient", FakeClient):
            with self.assertRaises(RuntimeError):
                asyncio.run(
                    brains._stream_openai_compatible(
                        "http://gateway/v1/chat/completions", {}, {}, base, False,
                        read_timeout=read,
                    )
                )
        return seen["timeout"]

    def test_read_budget_is_the_wall_clock_not_the_phase_timeout(self) -> None:
        timeout = self._timeout_of(35.0, 120.0)
        self.assertEqual(timeout.read, 120.0)
        self.assertEqual(timeout.connect, 10.0)
        self.assertEqual(timeout.write, 35.0)

    def test_without_a_read_budget_nothing_changes(self) -> None:
        timeout = self._timeout_of(8.0, None)
        self.assertEqual(timeout.read, 8.0)
        # A short base timeout must not be stretched to the 10s connect cap.
        self.assertEqual(timeout.connect, 8.0)
