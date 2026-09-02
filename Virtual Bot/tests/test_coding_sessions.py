"""
Кодинг-режим має ВЛАСНИЙ простір розмов.

Це не косметика: чат і кодинг — різні харнеси з різною історією. Якщо
простори злипнуться, кодингові задачі полізуть у список звичайних чатів
(і навпаки), а видалення в одному зачепить інший. Тест тримає межу.
"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import chat_store


class ChatKindIsolationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "chats"
        self.patch = patch.object(chat_store, "CHATS_DIR", self.root)
        self.patch.start()

    def tearDown(self) -> None:
        self.patch.stop()
        self.temp.cleanup()

    def test_default_kind_is_chat(self) -> None:
        self.assertEqual(chat_store.active_kind(), chat_store.KIND_CHAT)

    def test_code_conversation_is_invisible_to_chat_list(self) -> None:
        with chat_store.set_kind(chat_store.KIND_CODE):
            chat_store.append("codeone", "додай темну тему", "Готово")
            code_list = chat_store.list_sessions()

        chat_list = chat_store.list_sessions()

        self.assertEqual([s["id"] for s in code_list], ["codeone"])
        self.assertEqual(chat_list, [])

    def test_chat_conversation_is_invisible_to_code_list(self) -> None:
        chat_store.append("chatone", "привіт", "Вітаю")

        with chat_store.set_kind(chat_store.KIND_CODE):
            self.assertEqual(chat_store.list_sessions(), [])

        self.assertEqual([s["id"] for s in chat_store.list_sessions()], ["chatone"])

    def test_same_id_in_both_spaces_holds_different_conversations(self) -> None:
        """Однаковий id у двох просторах — це ДВІ різні розмови, не одна."""
        chat_store.append("shared", "питання в чаті", "відповідь чату")
        with chat_store.set_kind(chat_store.KIND_CODE):
            chat_store.append("shared", "задача кодера", "код написано")
            code = chat_store.load("shared")

        chat = chat_store.load("shared")

        self.assertEqual(code["messages"][0]["content"], "задача кодера")
        self.assertEqual(chat["messages"][0]["content"], "питання в чаті")

    def test_delete_in_one_space_leaves_the_other_untouched(self) -> None:
        chat_store.append("shared", "у чаті", "відповідь")
        with chat_store.set_kind(chat_store.KIND_CODE):
            chat_store.append("shared", "у кодингу", "готово")
            chat_store.delete("shared")
            self.assertEqual(chat_store.load("shared")["messages"], [])

        self.assertEqual(len(chat_store.load("shared")["messages"]), 2)

    def test_kind_context_is_restored_after_block(self) -> None:
        with chat_store.set_kind(chat_store.KIND_CODE):
            self.assertEqual(chat_store.active_kind(), chat_store.KIND_CODE)
        self.assertEqual(chat_store.active_kind(), chat_store.KIND_CHAT)

    def test_unknown_kind_falls_back_to_chat(self) -> None:
        """Сміття в параметрі не має створювати третій простір на диску."""
        with chat_store.set_kind("../evil"):
            self.assertEqual(chat_store.active_kind(), chat_store.KIND_CHAT)


class CodingSessionKeyTests(unittest.TestCase):
    """Живий процес omp прив'язаний до РОЗМОВИ, а не до проєкту."""

    def test_different_conversations_get_different_omp_sessions(self) -> None:
        import main

        first = main._code_session_key("user-1", "chat-a")
        second = main._code_session_key("user-1", "chat-b")
        other_user = main._code_session_key("user-2", "chat-a")

        self.assertNotEqual(first, second)
        self.assertNotEqual(first, other_user)


if __name__ == "__main__":
    unittest.main()
