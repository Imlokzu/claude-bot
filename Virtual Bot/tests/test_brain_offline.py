"""
Що каже чат, коли не відповів ЖОДЕН мозок.

Причина появи: демо-затичка маскувала поломку. 2026-09-02 ланцюг лежав (OpenClaw
віддавав 500, бо його власний провайдер — Omni-шим на 20128 — не був запущений),
а бот при цьому бадьоро вітався завченою фразою. Зрозуміти, що мозків немає,
можна було лише з логів, тож затичку типово вимкнено (`chat.demo_fallback`).

Тест фіксує обидві гілки: вимкнена затичка → чесний режим `offline`, увімкнена →
стара демо-поведінка (щоб прапорець лишався робочим, а не декоративним).
"""

from __future__ import annotations

import unittest
from unittest.mock import patch

import app_config as cfg
import brains


def _fail(*args, **kwargs):
    """Будь-який мозок, що падає, — саме так виглядає мертвий ланцюг."""
    raise RuntimeError("мозок недоступний")


def _reset_brain_state() -> None:
    """
    Знімає слід, який ці тести лишають у модулі.

    Падіння мозку зводить запобіжник (circuit breaker) на десятки секунд, а він
    живе в глобальних змінних `brains`. Без скидання наступний тест у прогоні
    бачив Omni «в бекофі», мовчки його пропускав і теж падав у offline — саме
    так тут і зламався test_chat_images_time, хоча сам по собі він зелений.
    """
    brains._omni_failed_at_mono = None
    brains._openclaw_failed_at_mono = None
    brains._last_successful_brain = None
    brains._last_model = ""


class NoBrainAnsweredTests(unittest.IsolatedAsyncioTestCase):
    """Усі мозки мовчать — застосунок не має вдавати розмову."""

    def setUp(self) -> None:
        self.addCleanup(_reset_brain_state)

    def _kill_every_brain(self):
        """Вимикає всі мозки одразу: ключів немає, виклики падають."""
        return [
            patch.object(brains.cfg, "get_openclaw_token", lambda: None),
            patch.object(brains.cfg, "get_anthropic_key", lambda: None),
            patch.object(brains, "chat_openclaw", _fail),
            patch.object(brains, "chat_omni", _fail),
            patch.object(brains, "chat_anthropic", _fail),
            patch.object(brains, "chat_chat2api", _fail),
        ]

    async def _run(self, demo_fallback: bool):
        patches = self._kill_every_brain()
        patches.append(patch.object(cfg, "CHAT_DEMO_FALLBACK", demo_fallback))
        for p in patches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in patches])
        return await brains.chat("Привіт")

    async def test_offline_instead_of_canned_reply(self) -> None:
        reply, emotion, mode, tools = await self._run(demo_fallback=False)
        # Головне: режим НЕ вдає робочий мозок — його видно і в /api/status
        self.assertEqual(mode, "offline")
        # І текст мусить казати про поломку, а не підтримувати розмову
        self.assertIn("мозку", reply.lower())
        self.assertEqual(emotion, "sad")
        self.assertEqual(tools, [])

    async def test_flag_restores_old_demo_behaviour(self) -> None:
        # Прапорець має лишатись робочим: інакше це не налаштування, а мертвий код
        _, _, mode, _ = await self._run(demo_fallback=True)
        self.assertEqual(mode, "demo")


class OfflineIsNotAWorkingBrainTests(unittest.IsolatedAsyncioTestCase):
    """`offline` не має видаватись за успіх у памʼяті останнього мозку."""

    def setUp(self) -> None:
        self.addCleanup(_reset_brain_state)

    async def test_status_reports_offline_not_a_brain_name(self) -> None:
        patches = [
            patch.object(brains.cfg, "get_openclaw_token", lambda: None),
            patch.object(brains.cfg, "get_anthropic_key", lambda: None),
            patch.object(brains, "chat_openclaw", _fail),
            patch.object(brains, "chat_omni", _fail),
            patch.object(brains, "chat_anthropic", _fail),
            patch.object(brains, "chat_chat2api", _fail),
            patch.object(cfg, "CHAT_DEMO_FALLBACK", False),
        ]
        for p in patches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in patches])

        await brains.chat("Привіт")
        self.assertEqual(brains.get_last_successful_brain(), "offline")
