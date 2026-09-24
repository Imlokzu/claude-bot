from __future__ import annotations

import asyncio
import json
import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

import brains
import main
import openclaw_models

CATALOG = json.dumps({
    "count": 2,
    "models": [
        {
            "key": "regolo/gpt-oss-120b",
            "name": "GPT-OSS 120B (Regolo, ~0.45 с)",
            "input": "text",
            "contextWindow": 200000,
            "available": True,
            "tags": ["default"],
        },
        {
            "key": "openai/gpt-6-luna",
            "name": "MiniMax M3",
            "input": "text,image",
            "contextWindow": 200000,
            "available": True,
            "tags": ["fallback#1"],
        },
    ],
})


def _reset_cache() -> None:
    openclaw_models._catalog = None
    openclaw_models._catalog_at = 0.0
    openclaw_models.set_selected("")


class CatalogTests(unittest.TestCase):
    def setUp(self) -> None:
        _reset_cache()

    def tearDown(self) -> None:
        _reset_cache()

    def test_normalizes_keys_context_and_tags(self) -> None:
        with patch.object(openclaw_models, "_run_cli", AsyncMock(return_value=(0, CATALOG, ""))):
            models = asyncio.run(openclaw_models.catalog(force=True))

        self.assertEqual(len(models), 2)
        self.assertEqual(openclaw_models.default_model(models), "regolo/gpt-oss-120b")
        vision = next(m for m in models if m["id"] == "openai/gpt-6-luna")
        self.assertTrue(vision["vision"])
        self.assertEqual(vision["fallback"], "fallback#1")
        self.assertEqual(vision["context"], 200000)
        self.assertEqual(vision["provider"], "openai")

    def test_hides_providers_other_than_regolo_and_chatgpt(self) -> None:
        raw = json.dumps({"models": [
            {"key": "opencode-go/kimi-k3", "name": "Kimi K3"},
            {"key": "nvidia/nemotron", "name": "Nemotron"},
            {"key": "regolo/gpt-oss-120b", "name": "GPT-OSS 120B"},
            {"key": "openai/gpt-6-sol", "name": "GPT-6 Sol"},
            {"key": "openai/gpt-6-luna", "name": "GPT-6 Luna"},
            {"key": "openai/gpt-5.6-luna", "name": "GPT-5.6-Luna"},
        ]})
        with patch.object(openclaw_models, "_run_cli", AsyncMock(return_value=(0, raw, ""))):
            models = asyncio.run(openclaw_models.catalog(force=True))
        self.assertEqual(
            [m["id"] for m in models],
            ["regolo/gpt-oss-120b", "openai/gpt-6-luna", "openai/gpt-5.6-luna"],
        )

    def test_broken_cli_keeps_the_previous_catalog(self) -> None:
        """Збій CLI не має спорожняти список: порожній вибір гірший за старий."""
        with patch.object(openclaw_models, "_run_cli", AsyncMock(return_value=(0, CATALOG, ""))):
            asyncio.run(openclaw_models.catalog(force=True))
        with patch.object(openclaw_models, "_run_cli", AsyncMock(return_value=(1, "", "boom"))):
            models = asyncio.run(openclaw_models.catalog(force=True))
        self.assertEqual(len(models), 2)


class NameTailTests(unittest.TestCase):
    """
    Хвіст у дужках з назви моделі.

    Каталог OpenClaw називає моделі «MiniMax M3 (бачить картинки, ~1.9 с)».
    У вузькому рядку композера такий підпис обрізається саме на корисному
    місці, тому хвіст розбирається на ознаки, а панель малює їх значками.
    """

    def test_splits_vision_and_speed_out_of_the_name(self) -> None:
        entry = openclaw_models._normalize(
            {"key": "omni/x/m", "name": "MiniMax M3 (бачить картинки, ~1.9 с)", "input": "text"}
        )
        self.assertEqual(entry["label"], "MiniMax M3")
        self.assertTrue(entry["vision"])
        self.assertEqual(entry["seconds"], 1.9)
        # 1.9 с — не швидка: поріг фіксований, щоб значок не мерехтів
        # залежно від того, хто поруч у списку.
        self.assertNotIn("fast", entry)

    def test_marks_a_quick_model(self) -> None:
        entry = openclaw_models._normalize(
            {"key": "omni/x/m", "name": "GPT-OSS 120B (Regolo, ~0.45 с)", "input": "text"}
        )
        self.assertEqual(entry["label"], "GPT-OSS 120B")
        self.assertTrue(entry["fast"])
        self.assertEqual(entry["seconds"], 0.45)
        self.assertNotIn("vision", entry)

    def test_leaves_a_plain_name_alone(self) -> None:
        entry = openclaw_models._normalize({"key": "omni/x/m", "name": "Claude Sonnet 5"})
        self.assertEqual(entry["label"], "Claude Sonnet 5")
        self.assertNotIn("seconds", entry)
        self.assertNotIn("vision", entry)

    def test_vision_from_input_still_counts(self) -> None:
        """`input` каталогу стоїть "text" навіть у зрячих, але якщо не стоїть — віримо."""
        entry = openclaw_models._normalize(
            {"key": "omni/x/m", "name": "Some Model", "input": "text,image"}
        )
        self.assertTrue(entry["vision"])

    def test_name_of_only_a_tail_falls_back_to_the_key(self) -> None:
        entry = openclaw_models._normalize({"key": "omni/x/m", "name": "(~0.3 с)"})
        self.assertEqual(entry["label"], "omni/x/m")
        self.assertTrue(entry["fast"])


class ChatHeaderTests(unittest.TestCase):
    def tearDown(self) -> None:
        openclaw_models.set_selected("")

    def test_no_header_without_a_choice(self) -> None:
        """Без вибору модель обирає сам OpenClaw — заголовок не шлемо."""
        openclaw_models.set_selected("")
        self.assertEqual(openclaw_models.chat_headers(), {})

    def test_header_carries_the_choice(self) -> None:
        openclaw_models.set_selected("omni/opencode-go/minimax-m3")
        self.assertEqual(
            openclaw_models.chat_headers(),
            {"x-openclaw-model": "omni/opencode-go/minimax-m3"},
        )

    def test_active_model_follows_the_override(self) -> None:
        """У шапці має стояти та модель, якою щойно відповіли."""
        openclaw_models.set_selected("omni/opencode-go/glm-5.3-flash")
        with patch.object(brains, "_last_successful_brain", "openclaw"):
            self.assertEqual(brains.get_last_model(), "glm-5.3-flash · OpenClaw")


class ThinkingTests(unittest.TestCase):
    def test_unset_value_reads_as_empty(self) -> None:
        unset = "Config path is valid but unset: agents.defaults.thinkingDefault."
        with patch.object(openclaw_models, "_run_cli", AsyncMock(return_value=(0, unset, ""))):
            self.assertEqual(asyncio.run(openclaw_models.get_thinking()), "")

    def test_rejects_a_level_openclaw_does_not_know(self) -> None:
        with patch.object(openclaw_models, "_run_cli", AsyncMock()) as run:
            self.assertFalse(asyncio.run(openclaw_models.set_thinking("вигаданий")))
        run.assert_not_awaited()

    def test_empty_level_unsets_instead_of_setting(self) -> None:
        with patch.object(openclaw_models, "_run_cli", AsyncMock(return_value=(0, "", ""))) as run:
            asyncio.run(openclaw_models.set_thinking(""))
        self.assertEqual(run.await_args.args[1], "unset")


class BrainEndpointTests(unittest.TestCase):
    def setUp(self) -> None:
        _reset_cache()
        self.client = TestClient(main.app)

    def tearDown(self) -> None:
        _reset_cache()

    def test_lists_models_with_selection_and_levels(self) -> None:
        with (
            patch.object(openclaw_models, "reachable", return_value=True),
            patch.object(openclaw_models, "_run_cli", AsyncMock(side_effect=[(0, CATALOG, ""), (0, "low", "")])),
        ):
            body = self.client.get("/api/brain/models").json()

        self.assertTrue(body["available"])
        self.assertEqual(body["default"], "regolo/gpt-oss-120b")
        self.assertEqual(body["thinking"], "low")
        self.assertIn("ultra", body["thinking_levels"])

    def test_refuses_a_model_openclaw_does_not_have(self) -> None:
        """Невідомий рядок поїхав би заголовком і впав уже в шлюзі."""
        with patch.object(openclaw_models, "_run_cli", AsyncMock(return_value=(0, CATALOG, ""))):
            response = self.client.post("/api/brain/model", json={"model": "вигадана/модель"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(openclaw_models.get_selected(), "")

    def test_accepts_a_real_model(self) -> None:
        with patch.object(openclaw_models, "_run_cli", AsyncMock(return_value=(0, CATALOG, ""))):
            response = self.client.post(
                "/api/brain/model", json={"model": "openai/gpt-6-luna"}
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(openclaw_models.get_selected(), "openai/gpt-6-luna")

    def test_rejects_an_unknown_thinking_level(self) -> None:
        response = self.client.post("/api/brain/thinking", json={"level": "вигаданий"})
        self.assertEqual(response.status_code, 400)


if __name__ == "__main__":
    unittest.main()
