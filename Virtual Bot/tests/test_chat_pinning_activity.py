from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import chat_store
import main
from emotions import settled_emotion
from fastapi.testclient import TestClient


class ChatPinningTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.chats = Path(self.temp.name)
        self.patch = patch.object(chat_store, "CHATS_DIR", self.chats)
        self.patch.start()

    def tearDown(self) -> None:
        self.patch.stop()
        self.temp.cleanup()

    def test_pinned_chats_are_persistent_and_sorted_first(self) -> None:
        chat_store.append("old", "Старий", "Відповідь")
        chat_store.append("new", "Новий", "Відповідь")
        old_path = self.chats / "old.json"
        old = json.loads(old_path.read_text())
        old["updated"] = 1
        old_path.write_text(json.dumps(old))

        self.assertTrue(chat_store.set_pinned("old", True))
        sessions = chat_store.list_sessions()

        self.assertEqual(sessions[0]["id"], "old")
        self.assertTrue(sessions[0]["pinned"])
        self.assertTrue(json.loads(old_path.read_text())["pinned"])

    def test_unknown_chat_cannot_be_pinned(self) -> None:
        self.assertFalse(chat_store.set_pinned("missing", True))

    def test_pin_api_persists_the_star(self) -> None:
        chat_store.append("chat-one", "Привіт", "Вітаю")
        with TestClient(main.app) as client:
            response = client.post("/api/sessions/chat-one/pin", json={"pinned": True})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(chat_store.list_sessions()[0]["pinned"])


class ActivitySettlementTests(unittest.TestCase):
    def test_process_emotions_settle_after_response(self) -> None:
        for emotion in ("working", "searching", "web", "writing", "loading", "thinking"):
            with self.subTest(emotion=emotion):
                self.assertEqual(settled_emotion(emotion), "idle")

    def test_real_moods_are_preserved(self) -> None:
        self.assertEqual(settled_emotion("happy"), "happy")
        self.assertEqual(settled_emotion("speaking"), "speaking")


if __name__ == "__main__":
    unittest.main()
