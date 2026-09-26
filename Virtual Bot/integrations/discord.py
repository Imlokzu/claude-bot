"""
Discord as another window onto the same chat.

Same contract as the Telegram bridge: DMs to the bot (and mentions of it in a
server) run the shared chat turn, forwarded messages are held as context
until the owner writes something, and only paired users are answered
(`!pair CODE` from the dashboard).

Transport: the Discord Gateway over `websockets` (already a dependency) for
incoming messages, REST over httpx for replies. Intents are the minimum:
DIRECT_MESSAGES and GUILD_MESSAGES. Message content of DMs and of messages
that mention the bot is delivered without the privileged MESSAGE_CONTENT
intent, so the bot works without asking Discord for extra permissions.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import random
import re
import secrets
import time
import uuid
from pathlib import Path
from typing import Any, Optional

import httpx

import app_config

from . import batching, formatting, secrets_store
from .locales import t

log = logging.getLogger("virtual_bot.integrations.discord")

NAME = "discord"
API = "https://discord.com/api/v10"
GATEWAY = "wss://gateway.discord.gg/?v=10&encoding=json"
TEXT_LIMIT = 2000
INTENTS = (1 << 9) | (1 << 12)  # GUILD_MESSAGES | DIRECT_MESSAGES
MAX_DOWNLOAD = 10 * 1024 * 1024
FORWARD = 1  # message_reference.type for a forwarded message


def session_id_for(channel_id: str, generation: int = 0) -> str:
    base = f"dc{channel_id}"
    return base if not generation else f"{base}-{generation}"


class DiscordBridge:
    def __init__(self) -> None:
        self._chat = None
        self._task: Optional[asyncio.Task] = None
        self._http: Optional[httpx.AsyncClient] = None
        self._batcher = batching.TurnBatcher(self._on_turn)
        self._locks: dict[str, asyncio.Lock] = {}
        self._last_own: dict[str, str] = {}
        self._stranger_replied: dict[str, float] = {}
        self._me: dict[str, Any] = {}
        self._seq: Optional[int] = None
        self.last_error = ""
        self.running = False

    def attach(self, chat, transcribe=None) -> None:
        self._chat = chat

    def config(self) -> dict[str, Any]:
        return secrets_store.load(NAME)

    def token(self) -> str:
        return str(self.config().get("token") or os.environ.get("DISCORD_BOT_TOKEN", "")).strip()

    def owners(self) -> list[str]:
        return [str(x) for x in self.config().get("owners", []) if str(x).isdigit()]

    def status(self) -> dict[str, Any]:
        cfg = self.config()
        token = self.token()
        app_id = cfg.get("application_id") or ""
        return {
            "id": NAME,
            "label": "Discord",
            "configured": bool(token),
            "connected": bool(token) and self.running and not self.last_error,
            "running": self.running,
            "error": self.last_error,
            "account": cfg.get("username", ""),
            "token": secrets_store.mask(token),
            "owners": len(self.owners()),
            "pair_code": cfg.get("pair_code", ""),
            # Adding the bot to a server is optional: DMs work without it.
            "invite_link": f"https://discord.com/oauth2/authorize?client_id={app_id}&scope=bot&permissions=67648" if app_id else "",
            "can_share_files": bool(token) and bool(self.owners()),
        }

    async def configure(self, token: str, clerk_user_id: str = "") -> dict[str, Any]:
        token = token.strip()
        if len(token) < 50 or " " in token:
            raise ValueError("bad_token")
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(f"{API}/users/@me", headers={"Authorization": f"Bot {token}"})
        if response.status_code != 200:
            raise ValueError("token_rejected")
        me = response.json()
        cfg = self.config()
        if cfg.get("token") != token:
            cfg["owners"] = []
        cfg.update({
            "token": token,
            "username": me.get("username", ""),
            "bot_id": me.get("id"),
            "application_id": me.get("id"),
            "pair_code": cfg.get("pair_code") or _new_code(),
            "clerk_user_id": clerk_user_id or cfg.get("clerk_user_id", ""),
        })
        secrets_store.save(NAME, cfg)
        await self.restart()
        return self.status()

    def new_pair_code(self) -> str:
        code = _new_code()
        secrets_store.update(NAME, pair_code=code)
        return code

    async def disconnect(self) -> None:
        await self.stop()
        secrets_store.clear(NAME)
        self.last_error = ""

    async def start(self) -> None:
        if (self._task and not self._task.done()) or not self.token():
            return
        self._task = asyncio.create_task(self._gateway_forever(), name="discord-gateway")

    async def stop(self) -> None:
        task, self._task = self._task, None
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        await self._batcher.close()
        if self._http:
            await self._http.aclose()
            self._http = None
        self.running = False

    async def restart(self) -> None:
        await self.stop()
        await self.start()

    # ------------------------------------------------------------ REST

    async def rest(self, method: str, path: str, **kwargs: Any) -> Any:
        client = self._http or httpx.AsyncClient(timeout=20)
        self._http = client
        headers = {"Authorization": f"Bot {self.token()}", "User-Agent": "ClaudeBot (https://github.com/imlokzu, 1.0)"}
        for _attempt in range(3):
            response = await client.request(method, API + path, headers=headers, **kwargs)
            if response.status_code == 429:
                # Rate limited: Discord says exactly how long to wait.
                retry = float((response.json() or {}).get("retry_after") or 1)
                await asyncio.sleep(min(retry, 10))
                continue
            if response.status_code >= 400:
                raise RuntimeError(f"discord {method} {path}: {response.status_code} {response.text[:200]}")
            return response.json() if response.content else None
        raise RuntimeError("discord: rate limited")

    # ------------------------------------------------------------ gateway

    async def _gateway_forever(self) -> None:
        import websockets

        backoff = 2.0
        try:
            while True:
                try:
                    async with websockets.connect(GATEWAY, max_size=8 * 1024 * 1024) as ws:
                        await self._session(ws)
                    backoff = 2.0
                except asyncio.CancelledError:
                    raise
                except Exception as exc:  # noqa: BLE001 — reconnect with backoff
                    self.running = False
                    text = str(exc)
                    self.last_error = "unauthorized" if "4004" in text else "network"
                    log.warning("Discord gateway: %s: %s", type(exc).__name__, text[:160])
                    if "4004" in text or "4014" in text:
                        return  # bad token / disallowed intents: retrying cannot help
                await asyncio.sleep(backoff + random.random())
                backoff = min(backoff * 2, 60)
        finally:
            self.running = False

    async def _session(self, ws) -> None:
        hello = json.loads(await ws.recv())
        interval = hello["d"]["heartbeat_interval"] / 1000
        self._seq = None

        async def heartbeat() -> None:
            await asyncio.sleep(interval * random.random())
            while True:
                await ws.send(json.dumps({"op": 1, "d": self._seq}))
                await asyncio.sleep(interval)

        beat = asyncio.create_task(heartbeat())
        try:
            await ws.send(json.dumps({"op": 2, "d": {
                "token": self.token(), "intents": INTENTS,
                "properties": {"os": "linux", "browser": "claude-bot", "device": "claude-bot"},
            }}))
            async for raw in ws:
                event = json.loads(raw)
                if event.get("s") is not None:
                    self._seq = event["s"]
                op = event.get("op")
                if op == 7 or op == 9:
                    return  # reconnect requested / invalid session: start over
                if op == 1:
                    await ws.send(json.dumps({"op": 1, "d": self._seq}))
                if op != 0:
                    continue
                kind = event.get("t")
                if kind == "READY":
                    self._me = event["d"].get("user") or {}
                    self.running = True
                    self.last_error = ""
                elif kind == "MESSAGE_CREATE":
                    try:
                        await self.handle_message(event["d"])
                    except Exception:  # noqa: BLE001 — one bad message must not drop the session
                        log.exception("Discord message failed")
        finally:
            beat.cancel()

    # ------------------------------------------------------------ messages

    async def handle_message(self, msg: dict[str, Any]) -> None:
        author = msg.get("author") or {}
        if author.get("bot") or author.get("id") == self._me.get("id"):
            return
        channel_id = str(msg.get("channel_id"))
        in_dm = not msg.get("guild_id")
        mentioned = any(u.get("id") == self._me.get("id") for u in msg.get("mentions") or [])
        if not in_dm and not mentioned:
            return  # in a server the bot speaks only when spoken to
        user_id = str(author.get("id"))
        text = re.sub(r"<@!?%s>" % re.escape(str(self._me.get("id", ""))), "", str(msg.get("content") or "")).strip()

        if user_id not in self.owners():
            await self._stranger(channel_id, user_id, text)
            return
        lower = text.lower()
        if lower in ("!new", "/new"):
            self._batcher.drop(channel_id)
            generations = dict(self.config().get("generations") or {})
            generations[channel_id] = int(generations.get(channel_id, 0)) + 1
            secrets_store.update(NAME, generations=generations)
            await self.send(channel_id, t("uk", "dc.new"))
            return
        if lower in ("!go", "/go"):
            await self._batcher.flush(channel_id)
            return

        incoming = await self._to_incoming(channel_id, msg, text)
        if incoming is None:
            return
        if not incoming.forwarded:
            self._last_own[channel_id] = str(msg.get("id"))
        self._batcher.feed(incoming)

    async def _stranger(self, channel_id: str, user_id: str, text: str) -> None:
        match = re.match(r"^[!/]pair\s+(\S+)", text)
        code = self.config().get("pair_code") or ""
        if match and code and secrets.compare_digest(match.group(1), code):
            owners = sorted(set(self.owners()) | {user_id})
            secrets_store.update(NAME, owners=owners, pair_code=_new_code())
            await self.send(channel_id, t("uk", "dc.paired"))
            return
        now = time.monotonic()
        if now - self._stranger_replied.get(user_id, -1e9) < 3600:
            return
        self._stranger_replied[user_id] = now
        await self.send(channel_id, t("uk", "dc.notPaired"))

    async def _to_incoming(self, channel_id: str, msg: dict[str, Any], text: str) -> Optional[batching.Incoming]:
        reference = msg.get("message_reference") or {}
        forwarded = reference.get("type") == FORWARD
        attachments_src = list(msg.get("attachments") or [])
        forward_from = ""
        if forwarded:
            snapshots = msg.get("message_snapshots") or []
            inner = (snapshots[0].get("message") if snapshots else None) or {}
            text = str(inner.get("content") or "")
            attachments_src = list(inner.get("attachments") or [])
            forward_from = "another Discord channel"
        attachments: list[dict[str, str]] = []
        notes: list[str] = []
        for item in attachments_src[:4]:
            mime = str(item.get("content_type") or "")
            name = str(item.get("filename") or "file")
            size = int(item.get("size") or 0)
            if mime in ("image/png", "image/jpeg", "image/webp", "image/gif") and size <= MAX_DOWNLOAD:
                saved = await self._save_upload(str(item.get("url") or ""), name, mime)
                if saved:
                    attachments.append(saved)
                    continue
            notes.append(f"file {name}, {formatting.human_size(size)}")
        if not (text or attachments or notes):
            return None
        return batching.Incoming(
            chat_id=channel_id, message_id=str(msg.get("id")), text=text,
            forwarded=forwarded, forward_from=forward_from,
            sender=(msg.get("author") or {}).get("username", ""),
            attachments=attachments, notes=notes,
        )

    async def _save_upload(self, url: str, name: str, mime: str) -> Optional[dict[str, str]]:
        if not url.startswith("https://cdn.discordapp.com/") and not url.startswith("https://media.discordapp.net/"):
            return None
        try:
            client = self._http or httpx.AsyncClient(timeout=20)
            self._http = client
            response = await client.get(url)
            response.raise_for_status()
            if len(response.content) > MAX_DOWNLOAD:
                return None
        except Exception as exc:  # noqa: BLE001
            log.warning("Discord download failed: %s", exc)
            return None
        filename = f"dc-{uuid.uuid4().hex[:16]}{Path(name).suffix.lower() or '.png'}"
        target = Path(app_config.UPLOADS_DIR) / filename
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(response.content)
        return {"url": f"/uploads/{filename}", "type": mime, "name": filename}

    def session_id(self, channel_id: str) -> str:
        generation = int((self.config().get("generations") or {}).get(channel_id, 0))
        return session_id_for(channel_id, generation)

    async def _on_turn(self, channel_id: str, items: list[batching.Incoming]) -> None:
        lock = self._locks.setdefault(channel_id, asyncio.Lock())
        async with lock:
            message, attachments = batching.compose(items)
            typing = asyncio.create_task(self._typing(channel_id))
            try:
                result = await self._chat(
                    message[:30_000], self.session_id(channel_id), attachments, "discord",
                    {"clerk_user_id": self.config().get("clerk_user_id", "")},
                )
            except Exception as exc:  # noqa: BLE001
                log.exception("Discord turn failed")
                result = {"bubbles": [f"Error: {type(exc).__name__}"]}
            finally:
                typing.cancel()
            await self.deliver(channel_id, result, self._last_own.get(channel_id))

    async def _typing(self, channel_id: str) -> None:
        try:
            while True:
                try:
                    await self.rest("POST", f"/channels/{channel_id}/typing")
                except Exception:  # noqa: BLE001
                    pass
                await asyncio.sleep(8)
        except asyncio.CancelledError:
            pass

    async def deliver(self, channel_id: str, result: dict[str, Any], reply_to: Optional[str] = None) -> None:
        bubbles = [b for b in (result.get("bubbles") or []) if str(b).strip()] or ([result["reply"]] if result.get("reply") else [])
        reaction = result.get("reaction")
        if reaction and reply_to:
            try:
                from urllib.parse import quote

                await self.rest("PUT", f"/channels/{channel_id}/messages/{reply_to}/reactions/{quote(str(reaction))}/@me")
            except Exception:  # noqa: BLE001 — decoration only
                pass
        first = True
        for bubble in bubbles:
            for chunk in formatting.split_text(str(bubble), TEXT_LIMIT - 50):
                await self.send(channel_id, chunk, reply_to=reply_to if first else None)
                first = False

    async def send(self, channel_id: str, text: str, reply_to: Optional[str] = None) -> None:
        payload: dict[str, Any] = {"content": text, "allowed_mentions": {"parse": []}}
        if reply_to:
            payload["message_reference"] = {"message_id": reply_to, "fail_if_not_exists": False}
        await self.rest("POST", f"/channels/{channel_id}/messages", json=payload)

    async def _dm_channel(self, user_id: str) -> str:
        channel = await self.rest("POST", "/users/@me/channels", json={"recipient_id": user_id})
        return str(channel["id"])

    async def send_to_owners(self, text: str) -> int:
        sent = 0
        for owner in self.owners():
            await self.send(await self._dm_channel(owner), text)
            sent += 1
        return sent

    async def share_package(self, pkg_id: str) -> int:
        import screen_store

        filename, data = await asyncio.to_thread(screen_store.pack, pkg_id)
        sent = 0
        for owner in self.owners():
            channel = await self._dm_channel(owner)
            await self.rest(
                "POST", f"/channels/{channel}/messages",
                data={"payload_json": json.dumps({"content": filename})},
                files={"files[0]": (filename, data, screen_store.CBP_MIME)},
            )
            sent += 1
        return sent


def _new_code() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(8))


bridge = DiscordBridge()
