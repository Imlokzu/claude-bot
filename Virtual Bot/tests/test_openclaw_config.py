"""Settings OpenClaw owns are read from OpenClaw, not from a local copy."""

from __future__ import annotations

import json
import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

import app_config
import brains
import main
import openclaw_config


class _Config:
    """Write a throwaway openclaw.json and point OPENCLAW_CONFIG_PATH at it."""

    def __init__(self, data: dict) -> None:
        self.data = data

    def __enter__(self) -> Path:
        self._tmp = TemporaryDirectory()
        path = Path(self._tmp.name) / "openclaw.json"
        path.write_text(json.dumps(self.data), encoding="utf-8")
        self._env = patch.dict(os.environ, {"OPENCLAW_CONFIG_PATH": str(path)})
        self._env.start()
        return path

    def __exit__(self, *exc: object) -> None:
        self._env.stop()
        self._tmp.cleanup()


class TokenTests(unittest.TestCase):
    def test_local_gateway_token_beats_a_stale_env_copy(self) -> None:
        config = {"gateway": {"auth": {"mode": "token", "token": "from-openclaw"}}}
        with _Config(config), patch.dict(os.environ, {"OPENCLAW_TOKEN": "stale"}):
            self.assertEqual(app_config.get_openclaw_token(), "from-openclaw")

    def test_remote_gateway_still_uses_the_env_token(self) -> None:
        config = {"gateway": {"auth": {"mode": "token", "token": "local-only"}}}
        with (
            _Config(config),
            patch.dict(os.environ, {"OPENCLAW_TOKEN": "remote"}),
            patch.object(app_config, "OPENCLAW_BASE_URL", "https://gateway.example.net"),
        ):
            self.assertEqual(app_config.get_openclaw_token(), "remote")

    def test_non_token_auth_falls_back_to_env(self) -> None:
        config = {"gateway": {"auth": {"mode": "password", "token": "ignored"}}}
        with _Config(config), patch.dict(os.environ, {"OPENCLAW_TOKEN": "env"}):
            self.assertEqual(app_config.get_openclaw_token(), "env")


class OmniKeyTests(unittest.TestCase):
    def test_key_comes_from_openclaw_env_vars(self) -> None:
        with _Config({"env": {"vars": {"OMNI_API_KEY": "sk-oc"}}}), patch.dict(os.environ):
            os.environ.pop("OMNI_API_KEY", None)
            self.assertEqual(app_config.get_omni_key(), "sk-oc")

    def test_saving_writes_openclaw_and_never_echoes_the_key(self) -> None:
        run = AsyncMock(return_value=(0, "", ""))
        with (
            _Config({}),
            TemporaryDirectory() as tmp,
            patch.object(main.cfg, "BASE_DIR", Path(tmp)),
            patch.object(main.openclaw_models, "_run_cli", run),
        ):
            (Path(tmp) / ".env").write_text("OMNI_API_KEY=old\nOTHER=1\n", encoding="utf-8")
            response = TestClient(main.app).post("/api/setup/keys", json={"omni_key": "sk-new"})
            env_after = (Path(tmp) / ".env").read_text(encoding="utf-8")

        self.assertEqual(response.status_code, 200)
        self.assertNotIn("sk-new", response.text)
        run.assert_awaited_once_with(
            "config", "set", "env.vars.OMNI_API_KEY", '"sk-new"', "--strict-json",
        )
        # The old copy is gone so it cannot shadow OpenClaw after a restart.
        self.assertEqual(env_after, "OTHER=1\n")


class ImageModelTests(unittest.TestCase):
    def test_image_turn_uses_openclaw_image_model(self) -> None:
        config = {"agents": {"defaults": {"imageModel": {"primary": "regolo/vision"}}}}
        with _Config(config):
            self.assertEqual(brains._image_headers(), {"x-openclaw-model": "regolo/vision"})

    def test_unset_image_model_sends_no_override(self) -> None:
        with _Config({}):
            self.assertEqual(brains._image_headers(), {})


class LookupTests(unittest.TestCase):
    def test_missing_file_reads_as_empty(self) -> None:
        with patch.dict(os.environ, {"OPENCLAW_CONFIG_PATH": "/tmp/definitely-missing/openclaw.json"}):
            self.assertEqual(openclaw_config.load(), {})
            self.assertIsNone(openclaw_config.gateway_token())


if __name__ == "__main__":
    unittest.main()
