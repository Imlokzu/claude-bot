"""
Unit tests for Agent Email tools and registry integration.
"""

from __future__ import annotations

import unittest
from tools import email_tools
from tools.registry import list_tools, execute_tool


class EmailToolsTests(unittest.IsolatedAsyncioTestCase):
    async def test_get_agent_email_default(self):
        res = await email_tools.get_agent_email("lokzu")
        self.assertEqual(res["status"], "ok")
        self.assertEqual(res["email"], "lokzu@ag.waveio.me")
        self.assertEqual(res["domain"], "ag.waveio.me")

    async def test_get_agent_email_custom_name(self):
        res = await email_tools.get_agent_email("qa_bot_1")
        self.assertEqual(res["status"], "ok")
        self.assertEqual(res["email"], "qa_bot_1@ag.waveio.me")

    async def test_registry_integration(self):
        tools = list_tools()
        names = [t["function"]["name"] for t in tools]
        self.assertIn("get_agent_email", names)
        self.assertIn("check_agent_inbox", names)
        self.assertIn("wait_for_otp_code", names)

        # Test executing tool via registry dispatcher
        res = await execute_tool("get_agent_email", {"agent_name": "lokzu"})
        self.assertEqual(res["status"], "ok")
        self.assertEqual(res["email"], "lokzu@ag.waveio.me")
