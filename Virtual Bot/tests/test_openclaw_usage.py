from __future__ import annotations

import asyncio
import json
import unittest
from unittest.mock import patch

import openclaw_usage

STATUS = {"providers": [{
    "provider": "openai", "displayName": "OpenAI", "plan": "plus",
    "windows": [{"label": "5h", "usedPercent": 94, "resetAt": 1}, {"label": "Week", "usedPercent": 15, "resetAt": 2}],
    "billing": [{"type": "balance", "amount": 0, "unit": "credits"}],
    "accountEmail": "someone@example.com",
}]}
SESSION = {"sessions": [{"key": "agent:main:k", "model": "gpt-6-luna", "modelProvider": "openai", "usage": {
    "input": 100, "output": 10, "cacheRead": 900, "cacheWrite": 0, "totalTokens": 1010,
    "totalCost": 0.5, "inputCost": 0.1, "outputCost": 0.05, "cacheReadCost": 0.35, "cacheWriteCost": 0,
    "missingCostEntries": 0, "messageCounts": {"assistant": 4}, "toolUsage": {"totalCalls": 2},
    "latency": {"avgMs": 1500},
}}]}
RANGE = {"sessions": [], "totals": {"input": 5, "totalCost": 0.01}, "cacheStatus": {"status": "refreshing"},
         "aggregates": {"byProvider": [
             {"provider": "nvidia", "count": 54, "totals": {"input": 200, "missingCostEntries": 22}},
             {"provider": "openclaw", "count": 27, "totals": {}},
         ]}}
MODELS_STATUS = {"auth": {"providers": [
    {"provider": "openai", "profiles": {"oauth": 1, "labels": ["openai:someone@example.com=OAuth"]}},
    {"provider": "regolo", "profiles": {"apiKey": 1, "labels": ["regolo:default=sk-Ly...Q"]}},
]}}


def fake_cli(responses: dict, calls: list):
    async def run(*args, timeout=None):
        method = "models.status" if args[:2] == ("models", "status") else args[2]
        if method == "sessions.usage" and '"agentScope"' in args[-1]:
            method = "sessions.usage:range"
        calls.append((method, args))
        if method not in responses:
            return 1, "", "boom"
        return 0, json.dumps(responses[method]), ""
    return run


class OpenClawUsageTests(unittest.TestCase):
    def setUp(self) -> None:
        openclaw_usage._cache.clear()

    def test_chat_snapshot_maps_session(self) -> None:
        calls: list = []
        with patch.object(openclaw_usage.openclaw_models, "_run_cli", fake_cli({"sessions.usage": SESSION}, calls)):
            snap = asyncio.run(openclaw_usage.chat_snapshot("virtual-bot-v2:abc"))
        session = snap["session"]
        self.assertEqual((session["input"], session["cacheRead"], session["totalCost"]), (100, 900, 0.5))
        self.assertEqual((session["turns"], session["tool_calls"], session["avg_latency_ms"]), (4, 2, 1500))
        self.assertEqual(json.loads(calls[0][1][-1])["key"], "virtual-bot-v2:abc")

    def test_chat_snapshot_without_key_skips_lookup(self) -> None:
        calls: list = []
        with patch.object(openclaw_usage.openclaw_models, "_run_cli", fake_cli({}, calls)):
            snap = asyncio.run(openclaw_usage.chat_snapshot(None))
        self.assertIsNone(snap["session"])
        self.assertEqual(calls, [])

    def test_accounts_merge_quota_traffic_and_configured(self) -> None:
        calls: list = []
        responses = {"usage.status": STATUS, "sessions.usage:range": RANGE, "models.status": MODELS_STATUS}
        with patch.object(openclaw_usage.openclaw_models, "_run_cli", fake_cli(responses, calls)):
            snap = asyncio.run(openclaw_usage.accounts_snapshot())

        by_name = {row["provider"]: row for row in snap["accounts"]}
        self.assertEqual(set(by_name), {"openai", "nvidia", "regolo"})  # internal "openclaw" dropped
        self.assertEqual(snap["accounts"][0]["provider"], "openai")      # quota-bearing account first
        self.assertEqual(by_name["openai"]["quota"]["plan"], "plus")
        self.assertEqual(by_name["openai"]["auth"], "oauth")
        self.assertEqual(by_name["nvidia"]["missingCostEntries"], 22)
        self.assertEqual(by_name["regolo"]["replies"], 0)
        self.assertTrue(snap["indexing"])
        self.assertTrue(snap["available"])
        dumped = json.dumps(snap)
        self.assertNotIn("example.com", dumped)
        self.assertNotIn("sk-", dumped)

    def test_failures_are_reported_not_cached(self) -> None:
        calls: list = []
        with patch.object(openclaw_usage.openclaw_models, "_run_cli", fake_cli({}, calls)):
            snap = asyncio.run(openclaw_usage.accounts_snapshot())
            asyncio.run(openclaw_usage.quota())
        self.assertFalse(snap["available"])
        self.assertEqual(snap["accounts"], [])
        self.assertEqual(sum(1 for c in calls if c[0] == "usage.status"), 2)

    def test_quota_is_cached_between_refetches(self) -> None:
        calls: list = []
        with patch.object(openclaw_usage.openclaw_models, "_run_cli", fake_cli({"usage.status": STATUS}, calls)):
            asyncio.run(openclaw_usage.quota())
            asyncio.run(openclaw_usage.quota())
        self.assertEqual(len(calls), 1)


if __name__ == "__main__":
    unittest.main()
