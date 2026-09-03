"""
Окрема консоль (/console): трасування ходу розмови й огляд процесів.

Перевіряємо саме те, заради чого консоль існує: після репліки видно, ЯКІ
мозки пробувались і скільки це тривало, а кроки поза ходом (тул від
зовнішнього мозку, розпізнавання голосу) не губляться.
"""

from __future__ import annotations

import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

import main
import events
import trace_log


class TraceLogTests(unittest.TestCase):
    """Модуль трасування сам по собі."""

    def setUp(self) -> None:
        trace_log.reset()

    def test_steps_stick_to_the_bound_turn(self) -> None:
        turn_id = trace_log.start_turn("chat", "привіт", "s1")
        with trace_log.bind(turn_id):
            trace_log.step("brain", "openclaw", "fail", "TimeoutError", 35000)
            trace_log.step("brain", "omni", "ok", "kimi-k3", 1200)
            trace_log.end_turn(mode="omni", model="kimi-k3", emotion="happy")

        data = trace_log.recent()
        self.assertEqual(len(data["turns"]), 1)
        turn = data["turns"][0]
        self.assertEqual([s["name"] for s in turn["steps"]], ["openclaw", "omni"])
        self.assertEqual(turn["mode"], "omni")
        self.assertTrue(turn["done"])
        self.assertIsNotNone(turn["ms"])
        self.assertEqual(data["events"], [])

    def test_step_without_a_turn_is_kept_separately(self) -> None:
        """ASR і тули зовнішнього мозку йдуть окремими HTTP-запитами — без
        цього кільця вони зникали б безслідно."""
        trace_log.step("asr", "whisper_local", "ok", "12 КБ → «привіт»", 900)
        data = trace_log.recent()
        self.assertEqual(data["turns"], [])
        self.assertEqual(len(data["events"]), 1)
        self.assertEqual(data["events"][0]["stage"], "asr")

    def test_recent_can_be_scoped_to_one_session(self) -> None:
        first = trace_log.start_turn("chat", "перше", "s1")
        with trace_log.bind(first):
            trace_log.end_turn(mode="demo")
        second = trace_log.start_turn("chat", "друге", "s2")
        with trace_log.bind(second):
            trace_log.end_turn(mode="demo")

        scoped = trace_log.recent("s1")
        self.assertEqual([turn["session"] for turn in scoped["turns"]], ["s1"])
        self.assertEqual(trace_log.recent("")["turns"], [])

    def test_log_history_can_be_scoped_to_one_session(self) -> None:
        events.publish_log({"session": "log-s1", "t": 1, "level": "INFO", "name": "test", "msg": "one"})
        events.publish_log({"session": "log-s2", "t": 2, "level": "INFO", "name": "test", "msg": "two"})

        self.assertEqual([entry["msg"] for entry in events.recent_logs("log-s1")], ["one"])
        self.assertEqual(events.recent_logs(""), [])

    def test_end_turn_is_idempotent(self) -> None:
        turn_id = trace_log.start_turn("chat", "текст")
        with trace_log.bind(turn_id):
            trace_log.end_turn(mode="demo")
            trace_log.end_turn(mode="openclaw")  # повторний виклик нічого не міняє
        self.assertEqual(trace_log.recent()["turns"][0]["mode"], "demo")

    def test_trace_never_raises_on_junk(self) -> None:
        """Трасування не має права зламати чат навіть на дивних аргументах."""
        turn_id = trace_log.start_turn("chat", "x" * 5000)
        with trace_log.bind(turn_id):
            trace_log.step("brain", "omni", "невідомий-стан", None, "не-число")
            trace_log.end_turn()
        turn = trace_log.recent()["turns"][0]
        self.assertLessEqual(len(turn["text"]), 400)
        self.assertEqual(turn["steps"][0]["state"], "ok")  # невідомий стан → ok


class ChatTraceTests(unittest.TestCase):
    """Хід чату справді потрапляє в /api/trace."""

    def setUp(self) -> None:
        trace_log.reset()

    def test_chat_turn_lands_in_trace(self) -> None:
        async def fake_chat(message, history, emit=None, **kwargs):
            trace_log.step("brain", "openclaw", "fail", "TimeoutError: не вклався у 35 с", 35000)
            trace_log.step("brain", "omni", "ok", "kimi-k3", 800)
            return "Привіт!", "happy", "omni", []

        with patch.object(main.brains, "chat", fake_chat), \
             patch.object(main, "_autoname_chat") as no_autoname:
            no_autoname.return_value = None
            with TestClient(main.app) as client:
                resp = client.post(
                    "/api/chat",
                    json={"message": "привіт", "stream": False, "session_id": "trace-test"},
                    headers={"Referer": "http://127.0.0.1:8100/screen"},
                )
                self.assertEqual(resp.status_code, 200)
                trace = client.get("/api/trace").json()

        turns = [t for t in trace["turns"] if t["session"] == "trace-test"]
        self.assertEqual(len(turns), 1)
        turn = turns[0]
        # Referer із екрана → джерело «screen», а не «chat»
        self.assertEqual(turn["source"], "screen")
        self.assertEqual(turn["mode"], "omni")
        self.assertEqual(
            [(s["name"], s["state"]) for s in turn["steps"]],
            [("openclaw", "fail"), ("omni", "ok")],
        )

    def test_failed_chat_closes_the_turn(self) -> None:
        """Хід не має лишатись вічно «думає…», якщо мозок кинув виняток."""
        async def boom(message, history, emit=None, **kwargs):
            raise RuntimeError("мозок впав")

        with patch.object(main.brains, "chat", boom):
            with TestClient(main.app) as client:
                with self.assertRaises(RuntimeError):
                    client.post(
                        "/api/chat",
                        json={"message": "привіт", "stream": False, "session_id": "trace-fail"},
                    )

        turns = [t for t in trace_log.recent()["turns"] if t["session"] == "trace-fail"]
        self.assertEqual(len(turns), 1)
        self.assertTrue(turns[0]["done"])
        self.assertIn("мозок впав", turns[0]["error"])


class ProcessesTests(unittest.TestCase):
    """Огляд ланцюга: /api/processes і сама сторінка консолі."""

    def test_processes_describe_the_chain(self) -> None:
        with TestClient(main.app) as client:
            data = client.get("/api/processes").json()
        keys = [p["key"] for p in data["processes"]]
        for expected in ("self", "openclaw", "omni", "vision", "display"):
            self.assertIn(expected, keys)
        for row in data["processes"]:
            self.assertIn("port", row)
            self.assertIn("listening", row)
            self.assertIn("role", row)
        self.assertIn("last_mode", data["brain"])

    def test_console_page_is_served(self) -> None:
        with TestClient(main.app) as client:
            self.assertEqual(client.get("/console").status_code, 200)
            self.assertEqual(client.get("/static/console/console.js").status_code, 200)
            self.assertEqual(client.get("/static/console/console.css").status_code, 200)


if __name__ == "__main__":
    unittest.main()
