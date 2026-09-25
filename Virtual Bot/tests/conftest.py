from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest

# Тести перевіряють логіку застосунку, а не Clerk: без цього кожен виклик
# гейтнутої ручки відповідав би 401, і 16 тестів падали б через відсутній
# JWT, а не через справжні регресії. Ставимо ДО імпорту main (він читає
# auth_clerk, а той — env при кожному запиті, але хай буде до всього).
os.environ.setdefault("CLERK_DISABLED", "1")

# Point OpenClaw (our reader and every `openclaw` subprocess) at a file that
# does not exist, so no test ever reads the owner's gateway token or rewrites
# their real config. Tests that need a config write their own and patch it in.
os.environ.setdefault(
    "OPENCLAW_CONFIG_PATH",
    str(Path(tempfile.gettempdir()) / "virtual-bot-tests" / "no-openclaw.json"),
)

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
