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
COST = {"days": 30, "totals": {"input": 5, "totalCost": 0.01}, "cacheStatus": {"status": "refreshing"}}


def fake_cli(responses: dict, calls: list):
    async def run(*args, timeout=None):
        method = args[2]
        calls.append(args)
        if method not in responses:
            return 1, "", "boom"
        return 0, json.dumps(responses[method]), ""
    return run


class OpenClawUsageTests(unittest.TestCase):
    def setUp(self) -> None:
        openclaw_usage._cache.clear()

    def test_snapshot_maps_gateway_answers(self) -> None:
        calls: list = []
        responses = {"usage.status": STATUS, "sessions.usage": SESSION, "usage.cost": COST}
        with patch.object(openclaw_usage.openclaw_models, "_run_cli", fake_cli(responses, calls)):
            snap = asyncio.run(openclaw_usage.snapshot("virtual-bot-v2:abc"))

        quota = snap["quota"][0]
        self.assertEqual(quota["plan"], "plus")
        self.assertEqual([w["used_percent"] for w in quota["windows"]], [94, 15])
        self.assertNotIn("accountEmail", json.dumps(snap))

        session = snap["session"]
        self.assertEqual((session["input"], session["cacheRead"], session["totalCost"]), (100, 900, 0.5))
        self.assertEqual((session["turns"], session["tool_calls"], session["avg_latency_ms"]), (4, 2, 1500))

        self.assertTrue(snap["totals"]["indexing"])
        self.assertEqual(snap["totals"]["output"], 0)

        session_call = next(c for c in calls if c[2] == "sessions.usage")
        self.assertEqual(json.loads(session_call[-1])["key"], "virtual-bot-v2:abc")

    def test_failures_are_none_and_not_cached(self) -> None:
        calls: list = []
        with patch.object(openclaw_usage.openclaw_models, "_run_cli", fake_cli({}, calls)):
            snap = asyncio.run(openclaw_usage.snapshot("k"))
            self.assertIsNone(snap["quota"])
            self.assertIsNone(snap["session"])
            self.assertIsNone(snap["totals"])
            asyncio.run(openclaw_usage.quota())
        self.assertEqual(sum(1 for c in calls if c[2] == "usage.status"), 2)

    def test_quota_is_cached_between_refetches(self) -> None:
        calls: list = []
        with patch.object(openclaw_usage.openclaw_models, "_run_cli", fake_cli({"usage.status": STATUS}, calls)):
            asyncio.run(openclaw_usage.quota())
            asyncio.run(openclaw_usage.quota())
        self.assertEqual(len(calls), 1)

    def test_no_session_key_skips_session_lookup(self) -> None:
        calls: list = []
        with patch.object(openclaw_usage.openclaw_models, "_run_cli", fake_cli({"usage.status": STATUS}, calls)):
            snap = asyncio.run(openclaw_usage.snapshot(None))
        self.assertIsNone(snap["session"])
        self.assertFalse(any(c[2] == "sessions.usage" for c in calls))


if __name__ == "__main__":
    unittest.main()
