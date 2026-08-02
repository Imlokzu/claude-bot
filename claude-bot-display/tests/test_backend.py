"""Tests for the new FastAPI backend."""

import os

os.environ["MOCK_BACKEND_DISABLE_STATE_LOOP"] = "1"

import pytest
from fastapi.testclient import TestClient

from backend.server import (
    app,
    push_emotion_change,
    push_heard,
    push_show_custom,
    push_speaking,
    push_speaking_chunk,
)


@pytest.fixture
def client():
    return TestClient(app)


class TestBackend:
    def test_health(self, client):
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}

    def test_websocket_echo(self, client):
        with client.websocket_connect("/ws/display") as ws:
            ws.send_json(
                {
                    "type": "swipe",
                    "data": {
                        "from_screen": "face",
                        "to_screen": "status",
                        "direction": "left",
                    },
                }
            )
            received = ws.receive_json()
            assert received["type"] == "swipe"
            assert received["data"]["to_screen"] == "status"

    def test_websocket_broadcast(self, client):
        with client.websocket_connect("/ws/display") as ws1:
            with client.websocket_connect("/ws/display") as ws2:
                ws1.send_json(
                    {
                        "type": "touch",
                        "data": {
                            "screen": "custom",
                            "x": 1,
                            "y": 2,
                            "action": "tap",
                        },
                    }
                )
                received1 = ws1.receive_json()
                received2 = ws2.receive_json()
                assert received1["type"] == "touch"
                assert received2["type"] == "touch"

    @pytest.mark.asyncio
    async def test_push_helpers(self, client):
        with client.websocket_connect("/ws/display") as ws:
            await push_emotion_change("happy")
            received = ws.receive_json()
            assert received["type"] == "emotion_change"
            assert received["data"]["emotion"] == "happy"

            await push_heard("test")
            received = ws.receive_json()
            assert received["type"] == "heard"
            assert received["data"]["text"] == "test"

            await push_speaking("response")
            received = ws.receive_json()
            assert received["type"] == "speaking"
            assert received["data"]["text"] == "response"

            await push_speaking_chunk(" chunk")
            received = ws.receive_json()
            assert received["type"] == "speaking_chunk"
            assert received["data"]["text"] == " chunk"

            await push_show_custom("text", "hello", 5)
            received = ws.receive_json()
            assert received["type"] == "show_custom"
            assert received["data"]["content_type"] == "text"

    def test_alarm_crud(self, client):
        response = client.post("/alarms", params={"hour": 7, "minute": 30, "label": "Wake up"})
        assert response.status_code == 200
        alarm_id = response.json()["id"]

        response = client.get("/alarms")
        assert response.status_code == 200
        alarms = response.json()
        assert any(a["id"] == alarm_id for a in alarms)

        response = client.delete(f"/alarms/{alarm_id}")
        assert response.status_code == 200
        assert response.json()["status"] == "deleted"

        response = client.get("/alarms")
        assert not any(a["id"] == alarm_id for a in response.json())

    def test_weather_endpoint(self, client):
        response = client.get("/weather")
        assert response.status_code == 200
        data = response.json()
        assert "temp_c" in data
        assert "condition" in data
        assert "icon" in data
