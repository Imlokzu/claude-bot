from __future__ import annotations

import asyncio
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import brains
import main
from fastapi.testclient import TestClient


class ChatImageTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.uploads = Path(self.temp.name)
        self.png = self.uploads / "photo.png"
        self.png.write_bytes(b"\x89PNG\r\n\x1a\n" + b"test-image")

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_loads_only_safe_uploaded_images(self) -> None:
        with patch.object(main.cfg, "UPLOADS_DIR", self.uploads):
            images = main._load_chat_images([
                {"url": "/uploads/photo.png", "type": "image/png"},
                {"url": "https://example.com/photo.png", "type": "image/png"},
                {"url": "/uploads/../secret.png", "type": "image/png"},
            ])
        self.assertEqual(len(images), 1)
        self.assertEqual(images[0]["mime"], "image/png")

    def test_rejects_fake_image_content(self) -> None:
        fake = self.uploads / "fake.png"
        fake.write_text("not an image")
        with patch.object(main.cfg, "UPLOADS_DIR", self.uploads):
            self.assertEqual(main._load_chat_images([
                {"url": "/uploads/fake.png", "type": "image/png"},
            ]), [])

    def test_provider_message_shapes_include_real_image_data(self) -> None:
        image = {"mime": "image/png", "data": "YWJj"}
        openai = brains._build_messages("system", [], "Що тут?", [image])[-1]["content"]
        self.assertEqual(openai[1]["type"], "image_url")
        self.assertEqual(openai[1]["image_url"]["url"], "data:image/png;base64,YWJj")

        captured = {}

        async def fake_call(headers, payload, tools, timeout, emit=None):
            captured.update(payload)
            return "ok", []

        with (
            patch.object(brains.cfg, "get_anthropic_key", return_value="key"),
            patch.object(brains, "_call_anthropic_with_tools", side_effect=fake_call),
        ):
            asyncio.run(brains.chat_anthropic("Що тут?", "system", [], images=[image]))
        content = captured["messages"][-1]["content"]
        self.assertEqual(content[0]["source"]["data"], "YWJj")
        self.assertEqual(content[-1]["text"], "Що тут?")

    def test_chat_api_passes_uploaded_image_to_brain(self) -> None:
        observed = {}

        async def fake_chat(message, history, emit=None, **kwargs):
            observed.update(kwargs)
            return "Бачу зображення", "happy", "test", []

        with (
            patch.object(main.cfg, "UPLOADS_DIR", self.uploads),
            patch.object(main.brains, "chat", side_effect=fake_chat),
            patch.object(main, "_save_history"),
            patch.object(main, "_extract_and_save_facts"),
            TestClient(main.app) as client,
        ):
            response = client.post("/api/chat", json={
                "message": "Що на фото?",
                "attachments": [{
                    "url": "/uploads/photo.png",
                    "name": "photo.png",
                    "type": "image/png",
                }],
            })

        self.assertEqual(response.status_code, 200)
        self.assertEqual(observed["images"][0]["mime"], "image/png")
        self.assertTrue(observed["images"][0]["data"])

    def test_image_request_skips_openclaw_and_uses_vision_capable_omni(self) -> None:
        image = {"mime": "image/png", "data": "YWJj"}

        async def fake_omni(message, system_prompt, history, emit=None, **kwargs):
            self.assertEqual(kwargs["images"], [image])
            return "[емоція:happy] Бачу", []

        with (
            patch.object(brains.cfg, "get_openclaw_token", return_value="token"),
            patch.object(brains.cfg, "get_omni_key", return_value="key"),
            patch.object(brains, "chat_openclaw") as openclaw,
            patch.object(brains, "chat_omni", side_effect=fake_omni),
        ):
            reply, _emotion, mode, _tools = asyncio.run(
                brains.chat("Що тут?", [], images=[image])
            )

        openclaw.assert_not_called()
        self.assertEqual(reply, "Бачу")
        self.assertEqual(mode, "omni")

    def test_image_goes_straight_to_vision_model(self) -> None:
        """
        З картинками vision-модель питається ПЕРШОЮ, а не як fallback:
        текстова модель на запит із зображенням чемно відповідає «не бачу» —
        для ланцюга це успіх, і fallback за винятком ніколи не спрацьовував.
        """
        calls = []
        image = {"mime": "image/png", "data": "YWJj"}

        async def fake_omni_call(message, system_prompt, model, history, **kwargs):
            calls.append(model)
            return "Бачу", []

        with (
            patch.object(brains, "get_selected_omni_model", return_value="opencode/text-only"),
            patch.object(brains.cfg, "OMNI_VISION_MODEL", "opencode-go/minimax-m3"),
            patch.object(brains, "_omni_call", side_effect=fake_omni_call),
        ):
            result, _tools = asyncio.run(brains.chat_omni(
                "Що тут?", "system", [], images=[image],
            ))

        self.assertEqual(result, "Бачу")
        self.assertEqual(calls, ["opencode-go/minimax-m3"])
        self.assertEqual(brains._last_omni_model, "opencode-go/minimax-m3")


class CurrentTimePromptTests(unittest.TestCase):
    def test_current_time_is_generated_fresh_for_each_prompt(self) -> None:
        class FirstDateTime:
            @classmethod
            def now(cls):
                return datetime(2026, 8, 5, 12, 30, tzinfo=timezone.utc)

        class SecondDateTime:
            @classmethod
            def now(cls):
                return datetime(2026, 8, 5, 12, 31, tzinfo=timezone.utc)

        with patch.object(brains, "datetime", FirstDateTime):
            first = brains.build_system_prompt("Котра година?")
        with patch.object(brains, "datetime", SecondDateTime):
            second = brains.build_system_prompt("Котра година?")

        self.assertRegex(first, r"2026-08-05T\d{2}:30:00[+-]\d{2}:\d{2}")
        self.assertRegex(second, r"2026-08-05T\d{2}:31:00[+-]\d{2}:\d{2}")
        self.assertNotEqual(first, second)


if __name__ == "__main__":
    unittest.main()
