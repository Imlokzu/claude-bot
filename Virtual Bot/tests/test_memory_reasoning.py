from __future__ import annotations

import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

import brain_context
import brains
import main
import memory
from tools import registry


class MemoryPersistenceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.template = self.root / "template"
        self.runtime = self.root / "runtime"
        self.template.mkdir()
        self.runtime.mkdir()
        for category in ("people", "topics", "logs"):
            (self.template / category).mkdir()
        self.patches = (
            patch.object(brain_context, "BRAIN_DIR", self.template),
            patch.object(brain_context, "BRAIN_RUNTIME_DIR", self.runtime),
        )
        for item in self.patches:
            item.start()

    def tearDown(self) -> None:
        for item in reversed(self.patches):
            item.stop()
        self.temp.cleanup()

    def test_extracts_ukrainian_favorite_car(self) -> None:
        self.assertIn(
            "Улюблене (машина): Subaru",
            brains.extract_user_facts("моя улюблена машина Subaru"),
        )

    def test_fact_saved_once_and_available_in_new_chat_prompt(self) -> None:
        with main._brain_context("first-chat"):
            main._extract_and_save_facts("моя улюблена машина Subaru")
            main._extract_and_save_facts("моя улюблена машина Subaru")

        owner = brain_context.init_user_brain(None)
        profile = memory.load_user_profile(owner)
        self.assertEqual(profile.count("Улюблене (машина): Subaru"), 1)

        with main._brain_context("brand-new-chat"):
            prompt = brains.build_system_prompt("Яка моя улюблена машина?")
            reply = brains._demo_reply_from_profile("Яка моя улюблена машина?", [])

        self.assertIn("Subaru", prompt)
        self.assertIn("не кажи «я не знаю»", prompt.casefold())
        self.assertEqual(reply, ("Твоя улюблена машина — Subaru.", "happy"))

    def test_chat_api_persists_before_model_call_and_forwards_reasoning(self) -> None:
        observed: dict = {}

        async def fake_chat(message, history, emit=None, **kwargs):
            if "prompt" not in observed:
                observed["prompt"] = brains.build_system_prompt(message)
                observed["kwargs"] = kwargs
            return "Запамʼятав", "writing", "test", []

        with patch.object(main.brains, "chat", side_effect=fake_chat), TestClient(main.app) as client:
            response = client.post("/api/chat", json={
                "message": "моя улюблена машина Subaru",
                "session_id": "first-chat",
                "reasoning_effort": "high",
            })

        self.assertEqual(response.status_code, 200)
        self.assertIn("Subaru", observed["prompt"])
        self.assertEqual(observed["kwargs"], {"reasoning_effort": "high"})

        owner_hash = hashlib.sha256(brain_context.DEFAULT_BRAIN_ID.encode()).hexdigest()
        profile = (self.runtime / owner_hash / "brain" / "people" / "user.md").read_text()
        self.assertIn("Subaru", profile)


class ReasoningCapabilityTests(unittest.TestCase):
    def test_model_metadata_and_safe_payload_mapping(self) -> None:
        qwen = brains.reasoning_capability("opencode-go/qwen3.7-max")
        claude = brains.reasoning_capability("claude/claude-sonnet-5")

        self.assertEqual(qwen["levels"], ["none", "low", "medium", "high"])
        self.assertEqual(claude["levels"], ["none"])
        self.assertEqual(
            brains._reasoning_payload("opencode-go/qwen3.7-max", "high"),
            {"reasoning_effort": "high"},
        )
        self.assertEqual(brains._reasoning_payload("claude/claude-sonnet-5", "high"), {})

    def test_models_endpoint_exposes_reasoning_capabilities(self) -> None:
        with TestClient(main.app) as client:
            response = client.get("/api/models")
            invalid = client.post("/api/chat", json={
                "message": "test",
                "reasoning_effort": "extreme",
            })

        self.assertEqual(response.status_code, 200)
        self.assertTrue(all("reasoning" in model for model in response.json()["models"]))
        self.assertEqual(invalid.status_code, 422)

    def test_memory_search_tool_is_registered(self) -> None:
        names = {tool["function"]["name"] for tool in registry.list_tools()}
        self.assertIn("memory_search", names)


if __name__ == "__main__":
    unittest.main()
