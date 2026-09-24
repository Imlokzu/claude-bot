"""
The chat behaves like a messenger: short bubbles, narration while the bot
works, and emoji reactions both ways.

These go through /api/chat end to end, because each promise spans the
stream, the saved history and the next turn — a unit test of one piece
would pass while the chat still showed a single wall of text.
"""

from __future__ import annotations

import json
import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

import main


def parse_sse(body: str) -> list[tuple[str, dict]]:
    events: list[tuple[str, dict]] = []
    name = None
    for line in body.splitlines():
        if line.startswith("event:"):
            name = line[len("event:"):].strip()
        elif line.startswith("data:") and name:
            events.append((name, json.loads(line[len("data:"):].strip())))
            name = None
    return events


def bubbles_from(events: list[tuple[str, dict]]) -> list[str]:
    out = [""]
    for name, data in events:
        if name == "break":
            out.append("")
        elif name == "delta":
            out[-1] += data["chunk"]
    return [b.strip() for b in out if b.strip()]


class MessengerStreamTests(unittest.TestCase):
    def run_chat(self, fake_chat, session_id: str, message: str = "привіт"):
        with patch.object(main.brains, "chat", fake_chat), patch.object(main, "_autoname_chat", AsyncMock()):
            client = TestClient(main.app)
            response = client.post("/api/chat", json={"message": message, "stream": True, "session_id": session_id})
        self.assertEqual(response.status_code, 200)
        return client, parse_sse(response.text)

    def test_narration_tools_and_answer_keep_their_order(self) -> None:
        # The owner's example: "ok, I'll search" → searching → "found it".
        async def chat(message, history, emit=None, **kwargs):
            await emit({"type": "note", "id": "r:m1", "text": "[емоція:спокій] Секунду, гля", "done": False})
            await emit({"type": "note", "id": "r:m1", "text": "[емоція:спокій] Секунду, гляну [[ms", "done": False})
            await emit({"type": "note", "id": "r:m1", "text": "[емоція:спокій] Секунду, гляну погоду.", "done": True})
            await emit({"type": "tool_start", "tool": "web_search", "call_id": "c1", "input": {"q": "Київ"}})
            await emit({"type": "tool_done", "tool": "web_search", "call_id": "c1", "result": {"ok": True}})
            await emit({"type": "delta", "chunk": "[емоція:happy] +18 і сонце.[[m"})
            await emit({"type": "delta", "chunk": "sg]] Парасоля не треба."})
            return "+18 і сонце.[[msg]] Парасоля не треба.", "happy", "test", []

        client, events = self.run_chat(chat, "messenger-order")
        notes = [data["bubbles"] for name, data in events if name == "note"]
        self.assertEqual(notes, [["Секунду, гля"], ["Секунду, гляну"], ["Секунду, гляну погоду."]])
        self.assertEqual(bubbles_from(events), ["+18 і сонце.", "Парасоля не треба."])

        done = events[-1][1]
        self.assertEqual(done["reply"], "+18 і сонце.\n\nПарасоля не треба.")
        self.assertEqual([p["type"] for p in done["parts"]], ["text", "steps", "text", "text"])
        self.assertTrue(done["parts"][0]["note"])
        self.assertEqual(done["parts"][1]["ids"], ["c1"])

        stored = client.get("/api/sessions/messenger-order").json()["messages"][-1]
        self.assertEqual(stored["parts"], done["parts"])
        # Voice, search and the device screen read `content`: no markup there.
        self.assertEqual(stored["content"], done["reply"])
        self.assertEqual(stored["id"], done["assistant_message_id"])

    def test_bot_can_answer_with_only_a_reaction(self) -> None:
        async def chat(message, history, emit=None, **kwargs):
            await emit({"type": "delta", "chunk": "[react:👍]"})
            return "[react:👍]", "happy", "test", []

        client, events = self.run_chat(chat, "messenger-react", message="дякую!")
        self.assertIn(("reaction", {"type": "reaction", "emoji": "👍"}), events)
        self.assertEqual(bubbles_from(events), [])
        done = events[-1][1]
        self.assertEqual((done["reply"], done["bubbles"], done["reaction"]), ("", [], "👍"))

        messages = client.get("/api/sessions/messenger-react").json()["messages"]
        self.assertEqual(messages[-2]["reaction"], "👍")
        self.assertEqual(messages[-2]["id"], done["user_message_id"])

    def test_non_streaming_clients_never_see_markup(self) -> None:
        async def chat(message, history, **kwargs):
            return "Раз.[[msg]]Два. [react:🔥]", "happy", "test", []

        with patch.object(main.brains, "chat", chat), patch.object(main, "_autoname_chat", AsyncMock()):
            body = TestClient(main.app).post(
                "/api/chat", json={"message": "hi", "session_id": "messenger-plain"},
            ).json()
        self.assertEqual(body["reply"], "Раз.\n\nДва.")
        self.assertEqual(body["bubbles"], ["Раз.", "Два."])
        self.assertEqual(body["reaction"], "🔥")


class UserReactionTests(unittest.TestCase):
    def test_bot_sees_the_reaction_on_its_next_turn_once(self) -> None:
        seen: list[str] = []

        async def chat(message, history, emit=None, **kwargs):
            seen.append(message)
            return "Перше.[[msg]]Друге.", "idle", "test", []

        with patch.object(main.brains, "chat", chat), patch.object(main, "_autoname_chat", AsyncMock()):
            client = TestClient(main.app)
            first = client.post("/api/chat", json={"message": "a", "session_id": "messenger-user"}).json()
            reacted = client.post("/api/sessions/messenger-user/reactions", json={
                "message_id": first["assistant_message_id"], "bubble": 1, "emoji": "❤️",
            })
            self.assertEqual(reacted.status_code, 200)
            self.assertEqual(reacted.json()["reactions"], {"1": "❤️"})
            client.post("/api/chat", json={"message": "b", "session_id": "messenger-user"})
            client.post("/api/chat", json={"message": "c", "session_id": "messenger-user"})

        self.assertNotIn("reacted", seen[0])
        self.assertIn('❤️ on "Друге."', seen[1])
        self.assertTrue(seen[1].endswith("b"))
        # Seen once is enough; repeating it every turn would read as nagging.
        self.assertNotIn("reacted", seen[2])

    def test_removing_a_reaction_before_the_next_turn_hides_it(self) -> None:
        seen: list[str] = []

        async def chat(message, history, emit=None, **kwargs):
            seen.append(message)
            return "Так.", "idle", "test", []

        with patch.object(main.brains, "chat", chat), patch.object(main, "_autoname_chat", AsyncMock()):
            client = TestClient(main.app)
            first = client.post("/api/chat", json={"message": "a", "session_id": "messenger-undo"}).json()
            target = {"message_id": first["assistant_message_id"], "bubble": 0}
            client.post("/api/sessions/messenger-undo/reactions", json={**target, "emoji": "😂"})
            removed = client.post("/api/sessions/messenger-undo/reactions", json={**target, "emoji": None})
            self.assertEqual(removed.json()["reactions"], {})
            client.post("/api/chat", json={"message": "b", "session_id": "messenger-undo"})
        self.assertNotIn("reacted", seen[1])

    def test_bad_reactions_are_refused(self) -> None:
        async def chat(message, history, **kwargs):
            return "Так.", "idle", "test", []

        with patch.object(main.brains, "chat", chat), patch.object(main, "_autoname_chat", AsyncMock()):
            client = TestClient(main.app)
            first = client.post("/api/chat", json={"message": "a", "session_id": "messenger-bad"}).json()
            url = "/api/sessions/messenger-bad/reactions"
            ok_id = first["assistant_message_id"]
            self.assertEqual(client.post(url, json={"message_id": ok_id, "emoji": "lol"}).status_code, 400)
            self.assertEqual(client.post(url, json={"message_id": ok_id, "bubble": 5, "emoji": "👍"}).status_code, 404)
            # The user's own message is not something they react to here.
            user_id = first["user_message_id"]
            self.assertEqual(client.post(url, json={"message_id": user_id, "emoji": "👍"}).status_code, 404)
            self.assertEqual(client.post(
                "/api/sessions/..etc/reactions", json={"message_id": ok_id, "emoji": "👍"},
            ).status_code, 400)

    def test_messages_saved_before_ids_existed_are_addressable(self) -> None:
        import chat_store

        with patch.object(chat_store, "_prune"):
            chat_store.append("messenger-legacy", "q", "old answer")
        data = chat_store.load("messenger-legacy")
        for message in data["messages"]:
            message.pop("id")
        chat_store._path("messenger-legacy").write_text(json.dumps(data), encoding="utf-8")
        self.assertEqual(chat_store.set_user_reaction("messenger-legacy", "idx:1", 0, "👍"), {"0": "👍"})


if __name__ == "__main__":
    unittest.main()
