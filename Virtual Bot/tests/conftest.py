from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

import chat_store


@pytest.fixture(autouse=True)
def isolated_chat_store():
    """
    Тести чату ходять через /api/chat, а той пише історію на диск. Без цієї
    ізоляції у справжньому user_data/chats/ осідали б файли з тестовими
    сесіями («alice-api», «test-stream») і засмічували список чатів у панелі.
    """
    with tempfile.TemporaryDirectory() as tmp:
        original = chat_store.CHATS_DIR
        chat_store.CHATS_DIR = Path(tmp) / "chats"
        try:
            yield
        finally:
            chat_store.CHATS_DIR = original
