from __future__ import annotations

import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

import brains
import chat_store
import main


class InlineToolCallTests(unittest.TestCase):
    """
    Виклик інструмента, НАДРУКОВАНИЙ у текст замість справжнього tool_call.

    Частина моделей (через агентний цикл OpenCode) вписує виклик прямо в
    відповідь. Раніше це потрапляло в чат сирим JSON, а сам інструмент не
    спрацьовував.
    """

    def test_executes_and_removes_printed_call(self) -> None:
        text = (
            'Гляну погоду.{ "tool": "tools__weather", "params": {"city": "Київ"} } '
            "Ось що вийшло."
        )
        with patch.object(
            brains, "_execute_tool_traced", AsyncMock(return_value={"temp": 12})
        ) as run:
            reply, results = asyncio.run(brains._run_inline_tool_calls(text))

        run.assert_awaited_once()
        # Префікс MCP-сервера (`tools__`) до реєстру не належить.
        self.assertEqual(run.await_args.args[0], "weather")
        self.assertEqual(run.await_args.args[1], {"city": "Київ"})
        self.assertNotIn("{", reply)
        self.assertEqual(reply, "Гляну погоду. Ось що вийшло.")
        self.assertEqual(results[0]["tool"], "weather")

    def test_keeps_json_inside_code_fence(self) -> None:
        """У блоці коду JSON — ілюстрація, а не виклик."""
        text = 'Ось приклад:\n```json\n{"tool": "weather", "params": {"city": "Київ"}}\n```\nкінець'
        with patch.object(brains, "_execute_tool_traced", AsyncMock()) as run:
            reply, results = asyncio.run(brains._run_inline_tool_calls(text))
        run.assert_not_awaited()
        self.assertEqual(reply, text)
        self.assertEqual(results, [])

    def test_ignores_unknown_tool(self) -> None:
        text = 'текст {"tool": "немає_такого", "params": {}} хвіст'
        with patch.object(brains, "_execute_tool_traced", AsyncMock()) as run:
            reply, results = asyncio.run(brains._run_inline_tool_calls(text))
        run.assert_not_awaited()
        self.assertEqual(reply, text)
        self.assertEqual(results, [])

    def test_plain_reply_is_untouched(self) -> None:
        text = "Звичайна відповідь без жодного JSON."
        reply, results = asyncio.run(brains._run_inline_tool_calls(text))
        self.assertEqual(reply, text)
        self.assertEqual(results, [])


class SystemPromptPartsTests(unittest.TestCase):
    def test_parts_join_back_into_the_same_prompt(self) -> None:
        """Розкладка контексту мусить рахувати РІВНО той промпт, що піде в модель."""
        parts = brains.system_prompt_parts("привіт")
        self.assertEqual(
            "\n".join(text for _name, text in parts),
            brains.build_system_prompt("привіт"),
        )
        self.assertIn("persona", [name for name, _ in parts])


class VoiceAndSpokenFlagTests(unittest.TestCase):
    """
    Мікрофон на ВХОДІ й синтез на ВИХОДІ — два незалежні факти.

    Надиктувати можна з вимкненою озвучкою, а набрати з клавіатури — з
    увімкненою. Поки це був один прапорець, бот отримував застереження про
    Whisper там, де його ніхто не слухав, і мовчав про одиниці там, де його
    читали вголос. Якщо прапорці колись зіллють назад в один — впаде тут.
    """

    def _keys(self, **flags) -> list[str]:
        parts = brains.system_prompt_parts("яка швидкість", **flags)
        return [name for name, _ in parts]

    def test_flags_are_independent(self) -> None:
        self.assertNotIn("asr", self._keys())
        self.assertNotIn("tts", self._keys())

        self.assertIn("asr", self._keys(voice=True))
        self.assertNotIn("tts", self._keys(voice=True))

        self.assertIn("tts", self._keys(spoken=True))
        self.assertNotIn("asr", self._keys(spoken=True))

        both = self._keys(voice=True, spoken=True)
        self.assertIn("asr", both)
        self.assertIn("tts", both)

    def test_voice_block_joins_any_turn_through_the_cascade(self) -> None:
        """Said into the mic, read aloud, or both: it is a live conversation."""
        self.assertNotIn("voice", self._keys())
        for flags in ({"voice": True}, {"spoken": True}, {"voice": True, "spoken": True}):
            keys = self._keys(**flags)
            self.assertIn("voice", keys)
            # The general rule comes first; the specific ones refine it
            self.assertLess(keys.index("voice"), min(keys.index(k) for k in ("tts", "asr") if k in keys))

    def test_voice_block_names_the_pipeline_and_a_hard_length(self) -> None:
        rules = brains._VOICE_RULES
        self.assertIn("speech recognition", rules)
        self.assertIn("speech synthesis", rules)
        self.assertIn("40 words", rules)
        # The dilution budget: a long rule at the end drowns in the tools block
        self.assertLess(len(rules), 1000)

    def test_asr_caveat_stays_closest_to_the_message(self) -> None:
        """Збите розпізнавання ламає розмову, невимовлена одиниця лише дратує."""
        self.assertEqual(self._keys(voice=True, spoken=True)[-1], "asr")

    def test_parts_join_back_into_the_same_prompt_with_flags(self) -> None:
        parts = brains.system_prompt_parts("привіт", voice=True, spoken=True)
        self.assertEqual(
            "\n".join(text for _name, text in parts),
            brains.build_system_prompt("привіт", voice=True, spoken=True),
        )

    def test_each_block_speaks_only_about_its_own_direction(self) -> None:
        """Правило про вихід не живе в застереженні про вхід, і навпаки."""
        for word in ("синтез", "уголос", "озвуч"):
            self.assertNotIn(word, brains._ASR_CAVEAT)
        for word in ("Whisper", "розпізнава", "мікрофон"):
            self.assertNotIn(word, brains._TTS_RULES)

    def test_spoken_block_demands_units_spelled_out(self) -> None:
        """Заради цього все й робилось: «км/год» вголос — «ка-ем-скісна-риска-год»."""
        self.assertIn("км/год", brains._TTS_RULES)
        self.assertIn("кілометрів на годину", brains._TTS_RULES)

    def test_endpoint_forwards_spoken_without_inventing_voice(self) -> None:
        observed: dict[str, object] = {}

        async def fake_chat(message, history=None, emit=None, **kwargs):
            observed.update(kwargs)
            return "гаразд", "idle", "test", []

        with (
            patch.object(main.brains, "chat", side_effect=fake_chat),
            patch.object(main, "_save_history"),
            patch.object(main, "_extract_and_save_facts"),
            TestClient(main.app) as client,
        ):
            response = client.post(
                "/api/chat", json={"message": "яка швидкість", "spoken": True}
            )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(observed.get("spoken"))
        self.assertNotIn("voice", observed)


class ChatContextEndpointTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(main.app)

    def test_breakdown_counts_draft_and_sums_parts(self) -> None:
        response = self.client.get("/api/chat/context", params={"message": "привіт"})
        self.assertEqual(response.status_code, 200)
        body = response.json()
        draft = next(p for p in body["parts"] if p["id"] == "draft")
        self.assertEqual(draft["chars"], len("привіт"))
        self.assertEqual(body["chars"], sum(p["chars"] for p in body["parts"]))
        self.assertIn("history", [p["id"] for p in body["parts"]])

    def test_rejects_broken_session_id(self) -> None:
        response = self.client.get("/api/chat/context", params={"session_id": "../etc"})
        self.assertEqual(response.status_code, 400)


class CompactTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(main.app)
        self.sid = "test-compact-session"

    def tearDown(self) -> None:
        chat_store.delete(self.sid)

    def test_compact_replaces_history_and_keeps_the_original(self) -> None:
        for i in range(3):
            chat_store.append(self.sid, f"питання {i}", f"відповідь {i}")

        with patch.object(
            brains, "chat", AsyncMock(return_value=("Стислий переказ.", "idle", "test", []))
        ):
            response = self.client.post(f"/api/sessions/{self.sid}/compact")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["before"], 6)
        self.assertEqual(body["after"], 1)

        data = chat_store.load(self.sid)
        self.assertEqual(len(data["messages"]), 1)
        self.assertTrue(data["messages"][0]["compacted"])
        self.assertEqual(data["messages"][0]["content"], "Стислий переказ.")

        # Оригінал мусить лежати поруч: стискання без можливості подивитись,
        # що саме викинули, — це втрата, а не стискання.
        archive = chat_store._path(self.sid).parent / body["archive"]
        self.assertTrue(archive.is_file())

    def test_refuses_to_compact_a_short_chat(self) -> None:
        chat_store.append(self.sid, "привіт", "привіт")
        response = self.client.post(f"/api/sessions/{self.sid}/compact")
        self.assertEqual(response.status_code, 400)

    def test_archive_does_not_show_up_as_a_second_chat(self) -> None:
        """Архів лежить у підтеці — інакше він потрапляв би в список розмов."""
        for i in range(2):
            chat_store.append(self.sid, f"питання {i}", f"відповідь {i}")
        chat_store.compact(self.sid, "Переказ.")
        ids = [s["id"] for s in chat_store.list_sessions(limit=100, include_empty=True)]
        self.assertEqual(ids.count(self.sid), 1)


if __name__ == "__main__":
    unittest.main()
