from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

import system_status


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(system_status.router)
    return TestClient(app)


def test_virtual_status_has_connection_and_audio_contract() -> None:
    with _client() as client:
        response = client.get("/api/system/status")

    assert response.status_code == 200
    payload = response.json()
    assert payload["mode"] == "virtual"
    assert payload["device"]["battery"]["level"] == 82
    assert payload["wifi"]["status"] == "connected"
    assert payload["bluetooth"]["enabled"] is True
    assert payload["audio"]["output"]["kind"] == "output"
    assert {route["id"] for route in payload["audio"]["routes"]} >= {
        "bot",
        "youtube",
        "alarm",
    }


def test_audio_devices_is_a_small_projection() -> None:
    with _client() as client:
        response = client.get("/api/system/audio/devices")

    assert response.status_code == 200
    payload = response.json()
    assert set(payload) == {"mode", "updated_at", "input", "output", "devices"}
    assert payload["input"]["kind"] == "input"
    assert payload["output"]["kind"] == "output"
    assert payload["devices"]


def test_network_is_a_small_projection() -> None:
    with _client() as client:
        response = client.get("/api/system/network")

    assert response.status_code == 200
    payload = response.json()
    assert set(payload) == {"mode", "updated_at", "wifi", "bluetooth"}
    assert payload["wifi"]["ssid"] == "Claude-Bot"
    assert payload["bluetooth"]["devices"]


def test_status_falls_back_to_virtual_when_collector_fails(monkeypatch) -> None:
    def fail() -> dict:
        raise RuntimeError("collector failed")

    monkeypatch.setattr(system_status, "_build_status", fail)
    with _client() as client:
        response = client.get("/api/system/status")

    assert response.status_code == 200
    assert response.json()["mode"] == "virtual"


def test_native_mode_keeps_the_same_contract(monkeypatch) -> None:
    monkeypatch.setattr(system_status.cfg, "cfg_bool", lambda *keys, default=False: default is False)
    with _client() as client:
        response = client.get("/api/system/status")

    assert response.status_code == 200
    payload = response.json()
    assert payload["mode"] == "native"
    assert payload["capabilities"]["native_controls"] is True
