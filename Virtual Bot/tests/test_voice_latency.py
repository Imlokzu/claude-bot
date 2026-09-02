"""
Швидкість голосу: живі проміжні результати ASR і набір відповіді словами.

Обидві поведінки народились із заміру: розпізнавання короткої фрази займало
5.7с німої паузи, а шлюз OpenClaw віддавав усю відповідь ОДНИМ чанком, тож
попри stream:true текст падав стіною.
"""

from __future__ import annotations

import io
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


class LumpReplyTests(unittest.TestCase):
    """Відповідь одним шматком має ДОЇХАТИ до фронтенду словами."""

    def _stream(self, chunks: list[str], reply: str):
        async def fake_chat(message, history, emit=None, **kwargs):
            for chunk in chunks:
                await emit({"type": "delta", "chunk": chunk})
            return reply, "happy", "openclaw", []

        with patch.object(main.brains, "chat", fake_chat):
            with TestClient(main.app) as client:
                resp = client.post(
                    "/api/chat",
                    json={"message": "дякую", "stream": True, "session_id": "lump-test"},
                )
        self.assertEqual(resp.status_code, 200)
        return _parse_sse(resp.text)

    def test_single_lump_is_typed_out_word_by_word(self) -> None:
        reply = (
            "Дякую тобі, друже! Мені приємно це чути, і я радий, "
            "що можу бути поруч у цей теплий день."
        )
        events = self._stream([reply], reply)
        deltas = [data for name, data in events if name == "delta"]
        # Один чанк на вході — багато дельт на виході (інакше стіна тексту)
        self.assertGreater(len(deltas), 5)

    def test_real_token_stream_is_not_chopped_further(self) -> None:
        """Справжній стрім дрібних токенів проходить як є — по чанку на дельту."""
        chunks = ["При", "віт", ", ", "як ", "спра", "ви?"]
        events = self._stream(chunks, "Привіт, як справи?")
        deltas = [data for name, data in events if name == "delta"]
        self.assertEqual(len(deltas), len(chunks))


class PartialAsrTests(unittest.TestCase):
    """Проміжне розпізнавання: контракт ендпоінта."""

    def test_partial_returns_draft_text(self) -> None:
        with patch.object(main.asr_whisper, "is_available", return_value=True), \
             patch.object(main.asr_whisper, "transcribe_partial", return_value="дякую тоб"):
            with TestClient(main.app) as client:
                resp = client.post(
                    "/api/asr/partial",
                    files={"audio": ("voice.webm", io.BytesIO(b"audio-bytes"), "audio/webm")},
                )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), {"text": "дякую тоб", "partial": True})

    def test_partial_is_503_when_disabled(self) -> None:
        """Вимкнені проміжні — чесна 503, щоб екран перестав їх слати."""
        with patch.object(main.cfg, "ASR_PARTIALS_ENABLED", False):
            with TestClient(main.app) as client:
                resp = client.post(
                    "/api/asr/partial",
                    files={"audio": ("voice.webm", io.BytesIO(b"x"), "audio/webm")},
                )
        self.assertEqual(resp.status_code, 503)

    def test_partial_rejects_empty_audio(self) -> None:
        with patch.object(main.asr_whisper, "is_available", return_value=True):
            with TestClient(main.app) as client:
                resp = client.post(
                    "/api/asr/partial",
                    files={"audio": ("voice.webm", io.BytesIO(b""), "audio/webm")},
                )
        self.assertEqual(resp.status_code, 400)

    def test_partial_failure_does_not_500(self) -> None:
        """Чорновий текст не вартий 500-ки: екран має просто не показати його."""
        with patch.object(main.asr_whisper, "is_available", return_value=True), \
             patch.object(main.asr_whisper, "transcribe_partial", side_effect=RuntimeError("нема моделі")):
            with TestClient(main.app) as client:
                resp = client.post(
                    "/api/asr/partial",
                    files={"audio": ("voice.webm", io.BytesIO(b"audio"), "audio/webm")},
                )
        self.assertEqual(resp.status_code, 503)


if __name__ == "__main__":
    unittest.main()
