"""The panel may read and write only the OpenClaw paths it lists."""

from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

import main
import openclaw_settings


class SnapshotTests(unittest.TestCase):
    def test_reads_allowlisted_values_and_hides_the_rest(self) -> None:
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "openclaw.json"
            path.write_text(json.dumps({
                "agents": {"defaults": {"thinkingDefault": "high", "timeoutSeconds": 90}},
                "gateway": {"auth": {"token": "should-not-leak"}},
                "tools": {"web": {"search": {"enabled": False}}},
            }), encoding="utf-8")
            with patch.object(openclaw_settings, "CONFIG_PATH", path):
                body = openclaw_settings.snapshot()

        self.assertTrue(body["available"])
        by_path = {field["path"]: field for field in body["fields"]}
        self.assertEqual(by_path["agents.defaults.thinkingDefault"]["value"], "high")
        self.assertEqual(by_path["agents.defaults.thinkingDefault"]["section"], "style")
        self.assertEqual(by_path["tools.web.search.enabled"]["section"], "tools")
        self.assertTrue(all(field["section"] != "openclaw" for field in body["fields"]))
        self.assertFalse(by_path["agents.defaults.thinkingDefault"]["unset"])
        self.assertEqual(by_path["agents.defaults.timeoutSeconds"]["value"], 90)
        self.assertFalse(by_path["tools.web.search.enabled"]["value"])
        # Unset bools surface the documented default, not a guessed off.
        self.assertTrue(by_path["agents.defaults.compaction.enabled"]["unset"])
        self.assertTrue(by_path["agents.defaults.compaction.enabled"]["value"])
        dumped = json.dumps(body)
        self.assertNotIn("should-not-leak", dumped)
        self.assertTrue(all(not field["path"].startswith("gateway") for field in body["fields"]))

    def test_missing_file_is_unavailable(self) -> None:
        with patch.object(openclaw_settings, "CONFIG_PATH", Path("/tmp/no-such-openclaw.json")):
            body = openclaw_settings.snapshot()
        self.assertFalse(body["available"])
        self.assertEqual(body["fields"], [])


class ApplyTests(unittest.TestCase):
    def test_unknown_path_never_reaches_the_cli(self) -> None:
        with patch.object(openclaw_settings.openclaw_models, "_run_cli", AsyncMock()) as run:
            with self.assertRaises(ValueError):
                self._apply("gateway.auth.token", "nope")
        run.assert_not_awaited()

    def test_enum_outside_the_schema_is_refused(self) -> None:
        with patch.object(openclaw_settings.openclaw_models, "_run_cli", AsyncMock()) as run:
            with self.assertRaises(ValueError):
                self._apply("tools.exec.mode", "yolo")
        run.assert_not_awaited()

    def test_bool_is_sent_as_strict_json(self) -> None:
        with patch.object(
            openclaw_settings.openclaw_models, "_run_cli", AsyncMock(return_value=(0, "", ""))
        ) as run:
            self.assertTrue(self._apply("tools.web.search.enabled", False))
        self.assertEqual(
            run.await_args.args,
            ("config", "set", "tools.web.search.enabled", "false", "--strict-json"),
        )

    def test_empty_value_unsets_the_path(self) -> None:
        with patch.object(
            openclaw_settings.openclaw_models, "_run_cli", AsyncMock(return_value=(0, "", ""))
        ) as run:
            self.assertTrue(self._apply("agents.defaults.thinkingDefault", ""))
        self.assertEqual(run.await_args.args[:3], ("config", "unset", "agents.defaults.thinkingDefault"))

    def test_integer_out_of_range_is_refused(self) -> None:
        with self.assertRaises(ValueError):
            self._apply("tools.web.search.maxResults", 99)

    @staticmethod
    def _apply(path: str, value: object) -> bool:
        import asyncio
        return asyncio.run(openclaw_settings.apply(path, value))


class EndpointTests(unittest.TestCase):
    def test_post_rejects_a_path_outside_the_catalog(self) -> None:
        client = TestClient(main.app)
        with patch.object(openclaw_settings.openclaw_models, "_run_cli", AsyncMock()) as run:
            response = client.post("/api/openclaw/settings", json={
                "path": "gateway.auth.token",
                "value": "nope",
            })
        self.assertEqual(response.status_code, 400)
        run.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
