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
            "key": "omni/regolo/gpt-oss-120b",
            "name": "GPT-OSS 120B (Regolo, ~0.45 с)",
            "input": "text",
            "contextWindow": 200000,
            "available": True,
            "tags": ["default"],
        },
        {
            "key": "omni/opencode-go/minimax-m3",
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
        self.assertEqual(openclaw_models.default_model(models), "omni/regolo/gpt-oss-120b")
        vision = next(m for m in models if m["id"] == "omni/opencode-go/minimax-m3")
        self.assertTrue(vision["vision"])
        self.assertEqual(vision["fallback"], "fallback#1")
        self.assertEqual(vision["context"], 200000)
        self.assertEqual(vision["provider"], "omni")

    def test_broken_cli_keeps_the_previous_catalog(self) -> None:
        """Збій CLI не має спорожняти список: порожній вибір гірший за старий."""
        with patch.object(openclaw_models, "_run_cli", AsyncMock(return_value=(0, CATALOG, ""))):
            asyncio.run(openclaw_models.catalog(force=True))
        with patch.object(openclaw_models, "_run_cli", AsyncMock(return_value=(1, "", "boom"))):
            models = asyncio.run(openclaw_models.catalog(force=True))
        self.assertEqual(len(models), 2)


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
        self.assertEqual(body["default"], "omni/regolo/gpt-oss-120b")
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
                "/api/brain/model", json={"model": "omni/opencode-go/minimax-m3"}
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(openclaw_models.get_selected(), "omni/opencode-go/minimax-m3")

    def test_rejects_an_unknown_thinking_level(self) -> None:
        response = self.client.post("/api/brain/thinking", json={"level": "вигаданий"})
        self.assertEqual(response.status_code, 400)


if __name__ == "__main__":
    unittest.main()
