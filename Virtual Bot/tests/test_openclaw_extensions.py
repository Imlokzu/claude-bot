"""MCP servers and skills are read from OpenClaw and changed only via its CLI."""

from __future__ import annotations

import json
import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from fastapi.testclient import TestClient

import extension_registries
import main
import openclaw_extensions
from openclaw_store import OpenClawStoreError

BRIDGE = {
    "command": str(main.cfg.BASE_DIR / ".venv/bin/python"),
    "args": [str(main.cfg.BASE_DIR / "tools_mcp.py")],
    "env": {"VBOT_URL": "http://127.0.0.1:8100"},
}


class _Config:
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


class InstalledTests(unittest.TestCase):
    def test_lists_servers_without_secret_values(self) -> None:
        config = {"mcp": {"servers": {
            "tools": BRIDGE,
            "search": {"command": "npx", "args": ["-y", "brave"], "env": {"BRAVE_API_KEY": "secret-1"}},
            "remote": {"url": "https://x.example/mcp", "headers": {"Authorization": "Bearer secret-2"}, "enabled": False},
        }}}
        with _Config(config):
            servers = openclaw_extensions.mcp_servers()

        dumped = json.dumps(servers)
        self.assertNotIn("secret-1", dumped)
        self.assertNotIn("secret-2", dumped)
        by_name = {item["name"]: item for item in servers}
        self.assertEqual(by_name["search"]["env_keys"], ["BRAVE_API_KEY"])
        self.assertEqual(by_name["remote"]["transport"], "http")
        self.assertFalse(by_name["remote"]["enabled"])
        self.assertTrue(by_name["tools"]["builtin"])
        # Bridges sort after the owner's own servers.
        self.assertEqual(servers[-1]["name"], "tools")

    def test_skills_come_from_the_cli(self) -> None:
        listing = json.dumps({"skills": [
            {"name": "weather", "disabled": False, "eligible": True, "source": "clawhub"},
            {"name": "1password", "disabled": True, "missing": {"bins": ["op"], "env": []}},
        ]})
        with patch.object(openclaw_extensions, "_run", return_value=listing):
            skills = openclaw_extensions.skills()
        self.assertEqual([item["name"] for item in skills], ["weather", "1password"])
        self.assertEqual(skills[1]["missing"], ["bins:op"])
        self.assertFalse(skills[1]["enabled"])


class EditTests(unittest.TestCase):
    def test_bridges_cannot_be_removed_or_disabled(self) -> None:
        with _Config({"mcp": {"servers": {"tools": BRIDGE}}}), patch.object(openclaw_extensions, "_run") as run:
            with self.assertRaises(OpenClawStoreError) as removed:
                openclaw_extensions.remove_mcp("tools")
            with self.assertRaises(OpenClawStoreError):
                openclaw_extensions.set_mcp_enabled("tools", False)
        self.assertEqual(removed.exception.code, "builtin")
        run.assert_not_called()

    def test_add_builds_the_cli_call_and_redacts_output(self) -> None:
        with _Config({}), patch.object(openclaw_extensions, "_run", return_value="saved sk-live-123") as run:
            result = openclaw_extensions.add_mcp(
                "brave", command="npx", args=["-y", "brave"], env={"BRAVE_API_KEY": "sk-live-123"},
            )
        self.assertEqual(
            run.call_args_list[0].args[0],
            ["mcp", "add", "brave", "--command", "npx", "--arg=-y", "--arg=brave", "--env", "BRAVE_API_KEY=sk-live-123"],
        )
        self.assertEqual(run.call_args_list[1].args[0], ["mcp", "reload"])
        self.assertNotIn("sk-live-123", result["output"])

    def test_failed_probe_does_not_leak_the_key(self) -> None:
        failure = OpenClawStoreError("probe failed for Authorization=Bearer tok-999", code="command_failed")
        with _Config({}), patch.object(openclaw_extensions, "_run", side_effect=failure):
            with self.assertRaises(OpenClawStoreError) as caught:
                openclaw_extensions.add_mcp("r", url="https://x.example/mcp", headers={"Authorization": "Bearer tok-999"})
        self.assertNotIn("tok-999", str(caught.exception))

    def test_existing_name_is_refused(self) -> None:
        with _Config({"mcp": {"servers": {"a": {"command": "x"}}}}), patch.object(openclaw_extensions, "_run") as run:
            with self.assertRaises(OpenClawStoreError) as caught:
                openclaw_extensions.add_mcp("a", command="y")
        self.assertEqual(caught.exception.code, "exists")
        run.assert_not_called()

    def test_skill_toggle_writes_skills_entries(self) -> None:
        with patch.object(openclaw_extensions, "_run", return_value="") as run:
            openclaw_extensions.set_skill_enabled("weather", False)
            with self.assertRaises(OpenClawStoreError):
                openclaw_extensions.set_skill_enabled("a.b", True)
        run.assert_called_once_with(
            ["config", "set", "skills.entries.weather.enabled", "false", "--strict-json"], timeout=30,
        )

    def test_skill_refs_are_validated(self) -> None:
        with patch.object(openclaw_extensions, "_run", return_value="ok") as run:
            openclaw_extensions.install_skill_ref("@steipete/weather")
            openclaw_extensions.install_skill_ref("skills-sh:anthropics/skills/pdf")
            for bad in ("--force", "git:https://evil", "@a/../b", "skills-sh:a/b"):
                with self.assertRaises(OpenClawStoreError):
                    openclaw_extensions.install_skill_ref(bad)
        self.assertEqual(run.call_count, 2)


REGISTRY_SERVER = {
    "name": "io.github.acme/weather-mcp",
    "version": "1.2.0",
    "packages": [
        {"registryType": "oci", "identifier": "acme/weather", "transport": {"type": "stdio"}},
        {
            "registryType": "npm", "identifier": "@acme/weather", "version": "1.2.0",
            "transport": {"type": "stdio"},
            "environmentVariables": [{"name": "WEATHER_KEY", "isRequired": True, "isSecret": True}],
        },
    ],
}


class RegistryTests(unittest.TestCase):
    def test_npm_package_beats_docker(self) -> None:
        plan = extension_registries._registry_plan(REGISTRY_SERVER)
        self.assertEqual(plan["command"], "npx")
        self.assertEqual(plan["args"], ["-y", "@acme/weather@1.2.0"])
        self.assertEqual(plan["env"][0]["name"], "WEATHER_KEY")

    def test_open_remote_beats_packages(self) -> None:
        server = {**REGISTRY_SERVER, "remotes": [{"type": "streamable-http", "url": "https://w.example/mcp"}]}
        self.assertEqual(extension_registries._registry_plan(server)["via"], "http")

    def test_templated_url_is_not_installable(self) -> None:
        server = {"name": "x", "remotes": [{"type": "sse", "url": "https://{tenant}.example/sse"}]}
        self.assertIsNone(extension_registries._registry_plan(server))

    def test_header_template_is_filled(self) -> None:
        fill = extension_registries.fill_template
        self.assertEqual(fill("Bearer {key}", "sk-1"), "Bearer sk-1")
        self.assertEqual(fill("Bearer {key}", "Bearer sk-1"), "Bearer sk-1")
        self.assertEqual(fill("", "raw"), "raw")

    def test_suggested_name_is_safe(self) -> None:
        self.assertEqual(extension_registries.suggest_name("io.github.Acme/Weather MCP!"), "weather-mcp")
        self.assertEqual(extension_registries.suggest_name("@owner/tool"), "tool")


class InstallEndpointTests(unittest.TestCase):
    def test_install_uses_the_catalog_plan_not_the_request(self) -> None:
        plan = {
            "kind": "mcp", "name": "weather-mcp", "transport": "stdio",
            "command": "npx", "args": ["-y", "@acme/weather@1.2.0"],
            "env": [{"name": "WEATHER_KEY", "required": True, "secret": True, "template": ""}],
            "headers": [],
        }
        with (
            patch.object(extension_registries, "plan", return_value=plan),
            patch.object(openclaw_extensions, "add_mcp", return_value={"ok": True, "name": "weather-mcp"}) as add,
        ):
            response = TestClient(main.app).post("/api/extensions/install", json={
                "source": "mcp-registry", "id": "io.github.acme/weather-mcp",
                "env": {"WEATHER_KEY": "k", "LD_PRELOAD": "/tmp/evil.so"},
            })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(add.call_args.kwargs["env"], {"WEATHER_KEY": "k"})
        self.assertEqual(add.call_args.kwargs["command"], "npx")

    def test_missing_required_value_is_a_400(self) -> None:
        plan = {
            "kind": "mcp", "name": "w", "command": "npx", "args": [],
            "env": [{"name": "WEATHER_KEY", "required": True, "secret": True, "template": ""}], "headers": [],
        }
        with (
            patch.object(extension_registries, "plan", return_value=plan),
            patch.object(openclaw_extensions, "add_mcp") as add,
        ):
            response = TestClient(main.app).post("/api/extensions/install", json={"source": "mcp-registry", "id": "w"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("WEATHER_KEY", response.json()["detail"])
        add.assert_not_called()

    def test_builtin_removal_is_forbidden(self) -> None:
        with _Config({"mcp": {"servers": {"tools": BRIDGE}}}), patch.object(openclaw_extensions, "_run") as run:
            response = TestClient(main.app).delete("/api/extensions/mcp/tools")
        self.assertEqual(response.status_code, 403)
        run.assert_not_called()

    def test_unknown_source_is_rejected(self) -> None:
        response = TestClient(main.app).get("/api/extensions/browse?source=evil")
        self.assertEqual(response.status_code, 422)


if __name__ == "__main__":
    unittest.main()
