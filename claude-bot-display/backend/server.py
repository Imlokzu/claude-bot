"""FastAPI backend for Claude Bot React display UI.

Run with:
    python -m backend.server --port 8001

Provides:
- WebSocket /ws/display for real-time UI updates
- REST endpoints for weather, alarms, and health
- Simulated state updates, streaming AI text, and clock/alarm checks
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from backend.services import Alarm, fetch_weather, get_alarm_service

logger = logging.getLogger("backend")
logging.basicConfig(level=logging.INFO)

_clients: set[WebSocket] = set()


async def _broadcast(message: dict[str, Any]) -> None:
    disconnected: set[WebSocket] = set()
    payload = json.dumps(message)
    for client in _clients:
        try:
            await client.send_text(payload)
        except Exception:
            disconnected.add(client)
    for client in disconnected:
        _clients.discard(client)


async def _state_loop() -> None:
    battery = 87
    while True:
        await asyncio.sleep(5)
        battery = (battery - 1) % 100
        await push_state_update(
            battery=battery,
            charging=battery < 30,
            wifi_connected=True,
            wifi_ssid="home-wifi",
            server_online=True,
            current_model="Claude Sonnet 5",
            cpu_percent=38,
            temperature_c=42,
        )


async def _clock_loop() -> None:
    while True:
        await asyncio.sleep(1)
        now = datetime.now()
        await _broadcast(
            {
                "type": "clock_tick",
                "data": {
                    "time": now.strftime("%H:%M:%S"),
                    "date": now.strftime("%A, %d %B"),
                },
            }
        )

        alarms = get_alarm_service().tick()
        for alarm in alarms:
            await _broadcast(
                {
                    "type": "alarm_triggered",
                    "data": {"id": alarm.id, "label": alarm.label},
                }
            )


async def _weather_loop() -> None:
    last = None
    while True:
        try:
            weather = await fetch_weather()
            payload = {
                "type": "weather_update",
                "data": {
                    "temp_c": weather.temp_c,
                    "condition": weather.condition,
                    "icon": weather.icon,
                    "location": weather.location,
                    "humidity": weather.humidity,
                    "wind_kph": weather.wind_kph,
                },
            }
            if payload != last:
                await _broadcast(payload)
                last = payload
        except Exception as exc:
            logger.warning("Weather update failed: %s", exc)
        await asyncio.sleep(300)  # refresh every 5 minutes


@asynccontextmanager
async def _lifespan(app: FastAPI):
    loops = []
    if not os.environ.get("MOCK_BACKEND_DISABLE_STATE_LOOP"):
        loops.append(asyncio.create_task(_state_loop()))
        loops.append(asyncio.create_task(_clock_loop()))
        loops.append(asyncio.create_task(_weather_loop()))
    yield
    for task in loops:
        task.cancel()
    for task in loops:
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(title="Claude Bot Backend", lifespan=_lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/weather")
async def weather(city: str = "Kyiv") -> dict[str, Any]:
    w = await fetch_weather(city)
    return {
        "temp_c": w.temp_c,
        "condition": w.condition,
        "icon": w.icon,
        "location": w.location,
        "humidity": w.humidity,
        "wind_kph": w.wind_kph,
    }


@app.post("/alarms")
async def create_alarm(hour: int, minute: int, label: str) -> dict[str, str]:
    alarm_id = str(uuid.uuid4())[:8]
    get_alarm_service().add(Alarm(id=alarm_id, hour=hour, minute=minute, label=label))
    return {"id": alarm_id, "status": "created"}


@app.get("/alarms")
async def list_alarms() -> list[dict[str, Any]]:
    return [
        {"id": a.id, "hour": a.hour, "minute": a.minute, "label": a.label, "enabled": a.enabled}
        for a in get_alarm_service().list()
    ]


@app.delete("/alarms/{alarm_id}")
async def delete_alarm(alarm_id: str) -> dict[str, str]:
    if get_alarm_service().remove(alarm_id):
        return {"status": "deleted"}
    return {"status": "not_found"}


@app.websocket("/ws/display")
async def display_websocket(websocket: WebSocket) -> None:
    await websocket.accept()
    _clients.add(websocket)
    logger.info("Display connected. Clients: %s", len(_clients))
    try:
        while True:
            raw = await websocket.receive_text()
            data = json.loads(raw)
            logger.info("Received: %s", data)
            await _broadcast(data)
    except WebSocketDisconnect:
        logger.info("Display disconnected")
    finally:
        _clients.discard(websocket)


# Public push helpers


async def push_state_update(
    battery: int = 78,
    charging: bool = False,
    wifi_connected: bool = True,
    wifi_ssid: str = "home-wifi",
    server_online: bool = True,
    current_model: str = "Claude Sonnet 5",
    cpu_percent: int | None = None,
    temperature_c: int | None = None,
) -> None:
    await _broadcast(
        {
            "type": "state_update",
            "data": {
                "battery": battery,
                "charging": charging,
                "wifi_connected": wifi_connected,
                "wifi_ssid": wifi_ssid,
                "server_online": server_online,
                "current_model": current_model,
                "cpu_percent": cpu_percent,
                "temperature_c": temperature_c,
            },
        }
    )


async def push_emotion_change(emotion: str) -> None:
    await _broadcast({"type": "emotion_change", "data": {"emotion": emotion}})


async def push_heard(text: str) -> None:
    await _broadcast({"type": "heard", "data": {"text": text}})


async def push_speaking(text: str) -> None:
    await _broadcast({"type": "speaking", "data": {"text": text}})


async def push_speaking_chunk(text: str) -> None:
    await _broadcast({"type": "speaking_chunk", "data": {"text": text}})


async def push_show_custom(content_type: str, content: str, duration_seconds: int = 0) -> None:
    await _broadcast(
        {
            "type": "show_custom",
            "data": {
                "content_type": content_type,
                "content": content,
                "duration_seconds": duration_seconds,
            },
        }
    )


if __name__ == "__main__":
    import argparse

    import uvicorn

    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8001)
    args = parser.parse_args()
    uvicorn.run(app, host=args.host, port=args.port)
