"""Activity must be useful without lying about success or leaking other chats."""
import asyncio
import json
import unittest
from unittest.mock import AsyncMock

from openclaw_activity import GatewayActivity
from tool_activity import ActivityLog, detail_for, safe_payload


class ActivityTests(unittest.TestCase):
    def test_parallel_calls_are_matched_by_id(self):
        log = ActivityLog()
        for call_id in ("one", "two"):
            log.record({"type": "tool_start", "tool": "search", "call_id": call_id,
                        "input": {"query": call_id}})
        log.record({"type": "tool_done", "tool": "search", "call_id": "one", "result": {"ok": True}})
        self.assertEqual([s["status"] for s in log.steps], ["done", "active"])
        self.assertEqual(log.steps[0]["detail"], "one")

    def test_progress_updates_existing_call_and_retains_result(self):
        log = ActivityLog()
        log.record({"type": "tool_start", "tool": "read", "input": {"path": "note.md"}})
        log.record({"type": "tool_progress", "tool": "read", "detail": "reading"})
        log.record({"type": "tool_done", "tool": "read", "result": {"text": "hello"}})
        self.assertEqual(len(log.steps), 1)
        self.assertEqual(log.steps[0]["result"], {"text": "hello"})

    def test_unknown_completion_is_never_success(self):
        log = ActivityLog()
        log.record({"type": "tool_start", "tool": "read"})
        self.assertEqual(log.finish()[0]["status"], "interrupted")

    def test_errors_and_duplicate_events(self):
        log = ActivityLog()
        event = {"type": "tool_done", "tool": "read", "call_id": "1", "result": {"isError": True}}
        log.record(event)
        log.record({**event, "type": "tool_start"})
        self.assertEqual(len(log.steps), 1)
        self.assertEqual(log.steps[0]["status"], "failed")

    def test_secrets_redacted_and_payload_bounded(self):
        result = safe_payload({"token": "secret123", "nested": {"api_key": "secret456"},
                               "text": "Bearer secret789", "password": "hidden"})
        self.assertNotIn("secret", str(result).replace("[redacted]", ""))
        self.assertNotIn("hidden", str(result))
        self.assertEqual(detail_for({"token": "abc", "seconds": 5}), "seconds=5")
        self.assertLessEqual(len(safe_payload({"a": "x" * 50000})), 8001)

    def test_text_results_cannot_expose_json_shell_or_header_secrets(self):
        for value in ('{"access_token": "my-secret"}', 'Authorization: Bearer my-secret',
                      'OPENCLAW_TOKEN=my-secret', 'https://user:my-secret@example.com'):
            self.assertNotIn('my-secret', safe_payload(value))

    def test_legacy_event_fields_remain_available(self):
        event = ActivityLog().record({"type": "tool_done", "tool": "weather",
                                      "input": {"city": "Berlin"}, "result": {"temp": 15}})
        self.assertEqual(event["input"], {"city": "Berlin"})
        self.assertEqual(event["result"], {"temp": 15})

    def test_mcp_application_error_is_not_a_successful_tool(self):
        event = ActivityLog().record({"type": "tool_done", "tool": "read", "result": {
            "content": [{"type": "text", "text": '{"result":{"error":"missing file"}}'}],
            "isError": False,
        }})
        self.assertEqual(event['step']['status'], 'failed')


class GatewayActivityTests(unittest.IsolatedAsyncioTestCase):
    def frame(self, observer, **data):
        return {"type": "event", "event": "agent", "payload": {
            "sessionKey": observer.session_key, "runId": "r1", "stream": "tool", "seq": 1,
            "data": {"name": "exec", "toolCallId": "call1", "phase": "start", **data},
        }}

    async def test_other_sessions_ignored_and_duplicate_transport_deduped(self):
        emit = AsyncMock()
        observer = GatewayActivity(emit)
        frame = self.frame(observer, args={"command": "pwd"})
        await observer.handle({**frame, "payload": {**frame["payload"], "sessionKey": "someone-else"}})
        emit.assert_not_awaited()
        await observer.handle(frame)
        await observer.handle({**frame, "event": "session.tool"})
        emit.assert_awaited_once()
        event = emit.call_args.args[0]
        self.assertEqual(event["call_id"], "r1:call1")
        self.assertEqual(event["input"], {"command": "pwd"})

    async def test_durable_session_key_is_preserved(self):
        observer = GatewayActivity(AsyncMock(), session_key="virtual-bot:stable")
        self.assertEqual(observer.session_key, "virtual-bot:stable")

    async def test_model_lifecycle_is_reported_to_request_owner(self):
        emit = AsyncMock()
        observer = GatewayActivity(emit)
        frame = self.frame(observer, phase="model", provider="nvidia", model="openai/gpt-oss-20b")
        frame["payload"]["stream"] = "lifecycle"
        await observer.handle(frame)
        self.assertEqual(emit.call_args.args[0], {
            "type": "model",
            "provider": "nvidia",
            "model": "openai/gpt-oss-20b",
        })

    async def test_preamble_narration_reaches_the_chat(self):
        # Frame shape captured from the live gateway on 2026-09-24: the
        # "I'll search now" sentence exists only on this stream.
        emit = AsyncMock()
        observer = GatewayActivity(emit)
        frame = {"type": "event", "event": "agent", "payload": {
            "sessionKey": observer.session_key, "runId": "r1", "stream": "item", "seq": 5,
            "data": {"itemId": "msg_1", "kind": "preamble", "phase": "update",
                     "progressText": "[емоція:спокій] Зараз пошукаю"},
        }}
        await observer.handle(frame)
        self.assertEqual(emit.call_args.args[0], {
            "type": "note", "id": "r1:msg_1", "text": "[емоція:спокій] Зараз пошукаю", "done": False,
        })

    async def test_answer_candidates_are_not_duplicated_as_narration(self):
        # The final answer also comes over HTTP; showing it twice is worse
        # than not showing it here at all.
        emit = AsyncMock()
        observer = GatewayActivity(emit)
        await observer.handle({"type": "event", "event": "agent", "payload": {
            "sessionKey": observer.session_key, "runId": "r1", "stream": "item", "seq": 6,
            "data": {"itemId": "msg_2", "kind": "answer_candidate", "progressText": "Готово"},
        }})
        emit.assert_not_awaited()

    async def test_native_progress_failure_and_lifecycle(self):
        emit = AsyncMock()
        observer = GatewayActivity(emit)
        await observer.handle(self.frame(observer, phase="update", partialResult={"text": "working"}))
        self.assertEqual(emit.call_args.args[0]["result"], {"text": "working"})
        self.assertEqual(emit.call_args.args[0]["type"], "tool_progress")
        observer.seen.clear()
        await observer.handle(self.frame(observer, phase="result", isError=True, result={"text": "no file"}))
        self.assertTrue(emit.call_args.args[0]["is_error"])
        frame = self.frame(observer)
        frame["payload"].update(stream="lifecycle", seq=2, data={"phase": "end"})
        await observer.handle(frame)
        self.assertTrue(observer.terminal.is_set())

    async def test_close_cancels_reader(self):
        observer = GatewayActivity(AsyncMock())
        observer.ws = AsyncMock()
        observer.task = asyncio.create_task(asyncio.sleep(60))
        await observer._close()
        self.assertTrue(observer.task.cancelled())
        observer.ws.close.assert_awaited_once()

    async def test_handshake_subscribes_before_reporting_ready(self):
        from unittest.mock import patch

        class Socket:
            def __init__(self):
                self.frames = asyncio.Queue()
                self.frames.put_nowait(json.dumps({"event": "connect.challenge"}))
                self.methods = []
                self.close = AsyncMock()

            async def send(self, raw):
                request = json.loads(raw)
                self.methods.append(request["method"])
                self.frames.put_nowait(json.dumps({"type": "res", "id": request["id"], "ok": True,
                    "payload": {"subscribed": True, "key": "agent:main:own"}}))

            async def recv(self):
                return await self.frames.get()

            def __aiter__(self):
                return self

            async def __anext__(self):
                return await self.recv()

        import json
        socket = Socket()
        emit = AsyncMock()
        with patch('openclaw_activity.websockets.connect', AsyncMock(return_value=socket)):
            async with GatewayActivity(emit) as observer:
                self.assertEqual(socket.methods, ['connect', 'sessions.subscribe', 'sessions.messages.subscribe'])
                self.assertEqual(observer.session_key, 'agent:main:own')
                self.assertEqual(emit.call_args.args[0]['status'], 'running')
                observer.terminal.set()
        socket.close.assert_awaited_once()

    async def test_subscription_failure_is_visible_without_breaking_reply(self):
        from unittest.mock import patch
        emit = AsyncMock()
        with patch('openclaw_activity.websockets.connect', AsyncMock(side_effect=OSError)):
            async with GatewayActivity(emit) as observer:
                self.assertIsNone(observer.task)
        self.assertEqual(emit.call_args.args[0]['status'], 'unavailable')


class ChatActivityIntegrationTests(unittest.TestCase):
    def test_activity_reaches_sse_and_survives_reopening_the_chat(self):
        from unittest.mock import patch
        from fastapi.testclient import TestClient
        import main

        async def chat(message, history, emit=None, **kwargs):
            await emit({"type": "tool_start", "tool": "read", "call_id": "one", "input": {"path": "note.md"}})
            await emit({"type": "tool_done", "tool": "read", "call_id": "one", "result": {"text": "data"}})
            await emit({"type": "tool_start", "tool": "read", "call_id": "two"})
            await emit({"type": "tool_done", "tool": "read", "call_id": "two", "is_error": True})
            await emit({"type": "delta", "chunk": "reply"})
            return "reply", "idle", "test", []

        with patch.object(main.brains, "chat", chat), patch.object(main, "_autoname_chat", AsyncMock()):
            client = TestClient(main.app)
            response = client.post('/api/chat', json={"message": "test", "session_id": "activity-test", "stream": True})
        events = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith('data: ')]
        self.assertEqual(events[0]['session_id'], 'activity-test')
        final = events[-1]['steps']
        self.assertEqual([step['status'] for step in final], ['done', 'failed'])
        restored = client.get('/api/sessions/activity-test').json()['messages'][-1]['steps']
        self.assertEqual(restored, final)
        self.assertEqual(restored[0]['input'], {'path': 'note.md'})

    def test_error_preserves_incomplete_actions_on_disk(self):
        from unittest.mock import patch
        from fastapi.testclient import TestClient
        import main

        async def chat(message, history, emit=None, **kwargs):
            await emit({"type": "tool_start", "tool": "read", "input": {"path": "note.md"}})
            raise RuntimeError('test failure')

        with patch.object(main.brains, 'chat', chat):
            client = TestClient(main.app)
            response = client.post('/api/chat', json={'message': 'test', 'session_id': 'activity-fail', 'stream': True})
        self.assertIn('event: error', response.text)
        stored = client.get('/api/sessions/activity-fail').json()['messages'][-1]
        self.assertEqual(stored['steps'][0]['status'], 'interrupted')


if __name__ == "__main__":
    unittest.main()
