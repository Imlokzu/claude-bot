"""The shim must not turn an agent into a text-only chatbot."""
import json
import unittest
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

import omni_shim


class ToolPassthroughTests(unittest.TestCase):
    def request(self, stream):
        return {
            "model": "regolo/gpt-oss-120b", "stream": stream,
            "tools": [{"type": "function", "function": {"name": "read", "parameters": {"type": "object"}}}],
            "tool_choice": "auto",
            "messages": [
                {"role": "user", "content": "Read the file"},
                {"role": "assistant", "content": None, "tool_calls": [
                    {"id": "c1", "type": "function", "function": {"name": "read", "arguments": "{}"}}]},
                {"role": "tool", "tool_call_id": "c1", "content": "file content"},
            ],
        }

    def run_proxy(self, stream, upstream_body, status=200):
        captured = []
        def upstream(request):
            captured.append(json.loads(request.content))
            return httpx.Response(status, content=upstream_body,
                                  headers={"content-type": "text/event-stream" if stream else "application/json"})
        real_client = httpx.AsyncClient
        with patch.object(omni_shim.cfg, 'get_regolo_asr_key', return_value='test-only'), \
             patch.object(omni_shim.httpx, 'AsyncClient', side_effect=lambda **kw: real_client(
                 transport=httpx.MockTransport(upstream), **kw)):
            response = TestClient(omni_shim.app).post('/v1/chat/completions', json=self.request(stream))
        return response, captured[0]

    def test_request_keeps_definitions_and_tool_result_ids(self):
        response, payload = self.run_proxy(False, json.dumps({"choices": [{"message": {"content": "ok"}}]}))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload['tools'], self.request(False)['tools'])
        self.assertEqual(payload['messages'][1]['tool_calls'][0]['id'], 'c1')
        self.assertEqual(payload['messages'][2]['tool_call_id'], 'c1')
        self.assertEqual(payload['model'], 'gpt-oss-120b')

    def test_stream_preserves_tool_fragments_and_finish_reason(self):
        body = 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c2"}]}}]}\n\n' \
               'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n' \
               'data: [DONE]\n\n'
        response, payload = self.run_proxy(True, body)
        self.assertEqual(response.text, body)
        self.assertTrue(payload['stream'])

    def test_non_stream_tool_only_reply_is_not_treated_as_empty(self):
        body = {"choices": [{"message": {"content": None, "tool_calls": [{"id": "c2"}]},
                            "finish_reason": "tool_calls"}]}
        response, _ = self.run_proxy(False, json.dumps(body))
        self.assertEqual(response.json()['choices'], body['choices'])

    def test_provider_error_does_not_echo_credentials_or_body(self):
        response, _ = self.run_proxy(False, 'secret-upstream-detail', status=401)
        self.assertEqual(response.status_code, 502)
        self.assertNotIn('secret-upstream-detail', response.text)
