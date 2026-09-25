"""The settings panel saves every profile field it shows."""

from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from fastapi.testclient import TestClient

import main
import profile_store


class ProfileSaveTests(unittest.TestCase):
    def test_style_fields_survive_the_request_model(self) -> None:
        with TemporaryDirectory() as tmp:
            with patch.object(profile_store, "PROFILE_PATH", Path(tmp) / "bot_profile.json"):
                client = TestClient(main.app)
                response = client.post("/api/setup", json={
                    "name": "Crab",
                    "reply_length": "detailed",
                    "use_emoji": False,
                    "spontaneous": False,
                })
                saved = profile_store.load()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(saved["reply_length"], "detailed")
        self.assertFalse(saved["use_emoji"])
        self.assertFalse(saved["spontaneous"])

    def test_omitted_style_fields_keep_their_value(self) -> None:
        with TemporaryDirectory() as tmp:
            with patch.object(profile_store, "PROFILE_PATH", Path(tmp) / "bot_profile.json"):
                profile_store.save({"use_emoji": False})
                TestClient(main.app).post("/api/setup", json={"name": "Crab"})
                saved = profile_store.load()

        self.assertFalse(saved["use_emoji"])


if __name__ == "__main__":
    unittest.main()
