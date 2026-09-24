"""Observe native Gateway tool events alongside the existing HTTP token stream.

The subscription is established BEFORE sending the chat request. Durable chat
threads provide a stable key so OpenClaw can reuse their cache lineage and
transcript; callers without a durable session still get an isolated random key
and may send their own history. Protocol verified against the installed
OpenClaw gateway/protocol documentation.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from urllib.parse import urlsplit, urlunsplit

import websockets

import app_config as cfg

log = logging.getLogger("virtual_bot.openclaw_activity")


class GatewayActivity:
    def __init__(self, emit, session_key: str | None = None):
        self.emit = emit
        # Keep the random fallback for short-lived callers that do not own a
        # durable conversation id.
        self.session_key = session_key or "virtual-bot:" + uuid.uuid4().hex
        self.ws = None
        self.task = None
        self.terminal = asyncio.Event()
        self.seen: set[tuple] = set()

    async def _rpc(self, method: str, params: dict) -> dict:
        request_id = uuid.uuid4().hex
        await self.ws.send(json.dumps({"type": "req", "id": request_id,
                                       "method": method, "params": params}))
        while True:
            frame = json.loads(await self.ws.recv())
            if frame.get("type") == "res" and frame.get("id") == request_id:
                if not frame.get("ok"):
                    # Errors can echo request payloads, including credentials.
                    raise RuntimeError("Gateway rejected activity subscription")
                return frame.get("payload", {})

    async def __aenter__(self):
        if self.emit is None:
            return self
        await self.emit({"type": "agent_status", "status": "connecting"})
        try:
            async def connect():
                address = urlsplit(cfg.OPENCLAW_BASE_URL)
                self.ws = await websockets.connect(
                    urlunsplit(("wss" if address.scheme == "https" else "ws",
                                address.netloc, address.path, "", "")),
                    proxy=None, open_timeout=4, close_timeout=1, max_size=2**20,
                )
                challenge = json.loads(await self.ws.recv())
                if challenge.get("event") != "connect.challenge":
                    raise RuntimeError("Unexpected Gateway handshake")
                await self._rpc("connect", {
                    "minProtocol": 4, "maxProtocol": 4,
                    "client": {"id": "gateway-client", "version": "1.0.0",
                               "platform": "python", "mode": "backend"},
                    "role": "operator", "scopes": ["operator.read"],
                    "caps": ["tool-events"], "auth": {"token": cfg.get_openclaw_token()},
                })
                # Visible HTTP runs publish session.tool to this subscription;
                # hidden runs publish agent events to exact-session subscribers.
                await self._rpc("sessions.subscribe", {})
                subscribed = await self._rpc("sessions.messages.subscribe", {"key": self.session_key})
                self.session_key = subscribed["key"]
            await asyncio.wait_for(connect(), timeout=5)
            self.task = asyncio.create_task(self._listen())
            await self.emit({"type": "agent_status", "status": "running"})
        except asyncio.CancelledError:
            await self._close()
            raise
        except Exception as exc:
            log.warning("Gateway activity unavailable: %s", type(exc).__name__)
            await self._close()
            await self.emit({"type": "agent_status", "status": "unavailable"})
        return self

    async def _listen(self):
        try:
            async for raw in self.ws:
                await self.handle(json.loads(raw))
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            log.warning("Gateway activity interrupted: %s", type(exc).__name__)
        if not self.terminal.is_set():
            await self.emit({"type": "agent_status", "status": "disconnected"})

    async def handle(self, frame: dict):
        if frame.get("type") != "event" or frame.get("event") not in ("agent", "session.tool"):
            return
        payload = frame.get("payload")
        if not isinstance(payload, dict) or payload.get("sessionKey") != self.session_key:
            return
        data = payload.get("data")
        if not isinstance(data, dict):
            return
        if payload.get("stream") == "lifecycle" and data.get("phase") == "model":
            provider = str(data.get("provider") or "").strip()
            model = str(data.get("model") or "").strip()
            if provider and model:
                # Internal metadata for the request owner; do not render this
                # as a user-facing chat event.
                await self.emit({"type": "model", "provider": provider, "model": model})
            return
        run_id = str(payload.get("runId") or "")
        if payload.get("seq") is not None:
            identity = (run_id, payload["seq"])
            if identity in self.seen:
                return
            self.seen.add(identity)
        if payload.get("stream") == "lifecycle":
            if data.get("phase") in ("end", "error"):
                self.terminal.set()
            return
        if payload.get("stream") == "item":
            # What the model says BEFORE a tool call ("ok, I'll look it up")
            # only travels here: the HTTP stream carries just the final answer,
            # delivered after all tools have run. `progressText` is a growing
            # snapshot of that message, not a delta.
            text = data.get("progressText")
            if data.get("kind") == "preamble" and data.get("itemId") and isinstance(text, str):
                await self.emit({"type": "note", "id": f"{run_id}:{data['itemId']}",
                                 "text": text, "done": data.get("phase") == "end"})
            return
        if payload.get("stream") != "tool":
            return
        kind = {"start": "tool_start", "update": "tool_progress", "result": "tool_done"}.get(data.get("phase"))
        if not kind or not data.get("toolCallId"):
            return
        event = {"type": kind, "tool": data.get("name", "tool"),
                 "call_id": f"{run_id}:{data['toolCallId']}", "source": "openclaw"}
        if "args" in data:
            event["input"] = data["args"]
        if "result" in data or "partialResult" in data:
            event["result"] = data.get("result", data.get("partialResult"))
        event["is_error"] = bool(data.get("isError") or data.get("error") or data.get("toolErrorSummary"))
        await self.emit(event)

    async def _close(self):
        if self.task:
            self.task.cancel()
            await asyncio.gather(self.task, return_exceptions=True)
        if self.ws:
            await self.ws.close()

    async def __aexit__(self, exc_type, exc, tb):
        try:
            if exc_type is None and self.task and not self.task.done():
                # Let the terminal tool frame arrive on the parallel transport.
                try:
                    await asyncio.wait_for(self.terminal.wait(), timeout=1)
                except asyncio.TimeoutError:
                    pass
        finally:
            await self._close()
