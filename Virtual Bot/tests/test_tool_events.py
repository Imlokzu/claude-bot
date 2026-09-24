from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

import events
import main


class ToolDetailTests(unittest.TestCase):
    """
    The line the panel shows for a tool call.

    It answers "what is it doing right now", so an empty line is a failure of
    the feature, not a neutral default: the reader is left with a spinner and
    no idea whether the bot is searching, writing or stuck.
    """

    def test_prefers_the_most_telling_argument(self) -> None:
        self.assertEqual(main._tool_detail({"query": "гепард вага"}), "гепард вага")
        self.assertEqual(main._tool_detail({"city": "Київ"}), "Київ")
        self.assertEqual(main._tool_detail({"path": "нотатки/день.md"}), "нотатки/день.md")

    def test_covers_arguments_the_panel_had_not_seen(self) -> None:
        self.assertEqual(main._tool_detail({"url": "https://example.com"}), "https://example.com")
        self.assertEqual(main._tool_detail({"message": "привіт"}), "привіт")
        self.assertEqual(main._tool_detail({"video_id": "abc123"}), "abc123")

    def test_falls_back_to_the_arguments_themselves(self) -> None:
        """A tool nobody taught us about still says something."""
        line = main._tool_detail({"seconds": 30, "direction": "forward"})
        self.assertIn("seconds=30", line)
        self.assertIn("direction=forward", line)

    def test_survives_junk(self) -> None:
        self.assertEqual(main._tool_detail({}), "")
        self.assertEqual(main._tool_detail({"flag": True}), "")
        self.assertEqual(main._tool_detail(None), "")


class ToolEventStateTests(unittest.TestCase):
    """A failed tool must not look like a successful one."""

    def test_publish_keeps_fail_as_its_own_state(self) -> None:
        with patch.object(events, "publish") as publish:
            events.publish_tool("web_search", "гепард", "fail")
        self.assertEqual(publish.call_args.args[0]["state"], "fail")

    def test_unknown_state_falls_back_to_start(self) -> None:
        with patch.object(events, "publish") as publish:
            events.publish_tool("web_search", "гепард", "хтозна")
        self.assertEqual(publish.call_args.args[0]["state"], "start")


class ToolCallEventTests(unittest.TestCase):
    """
    /api/tools/call is the road OpenClaw's own tools take: its MCP bridges
    (tools_mcp, workspace_mcp) proxy every call here. The events published
    from this handler are the only trace of that work the panel can see.
    """

    def setUp(self) -> None:
        self.client = TestClient(main.app)

    def _call(self, result: dict) -> list[tuple]:
        with patch.object(main.tools, "execute_tool", AsyncMock(return_value=result)), \
             patch.object(main.events, "publish_tool") as publish:
            resp = self.client.post(
                "/api/tools/call",
                json={"name": "weather", "args": {"city": "Київ"}},
            )
        self.assertEqual(resp.status_code, 200)
        return [call.args for call in publish.call_args_list]

    def test_reports_start_and_done_with_the_argument(self) -> None:
        calls = self._call({"temperature": 23})
        self.assertEqual(calls[0], ("weather", "Київ", "start"))
        self.assertEqual(calls[-1], ("weather", "Київ", "done"))

    def test_a_tool_that_errored_is_reported_as_failed(self) -> None:
        calls = self._call({"error": "DuckDuckGo не відповів"})
        self.assertEqual(calls[-1], ("weather", "Київ", "fail"))

    def test_loopback_search_does_not_need_a_clerk_session(self) -> None:
        """OpenClaw's tool bridge is local and has no browser token. Search
        from that process must run; the same call from another host must not."""
        with patch.object(main.auth_clerk, "is_auth_disabled", return_value=False), \
             patch.object(main.tools, "execute_tool", AsyncMock(return_value={"results": []})):
            local = TestClient(main.app, client=("127.0.0.1", 50000))
            ok = local.post("/api/tools/call", json={"name": "web_search", "args": {"query": "b2c"}})
            self.assertEqual(ok.status_code, 200)
            remote = TestClient(main.app, client=("203.0.113.5", 50000))
            denied = remote.post("/api/tools/call", json={"name": "web_search", "args": {"query": "b2c"}})
            self.assertEqual(denied.status_code, 401)


if __name__ == "__main__":
    unittest.main()
