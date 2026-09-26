"""
Telegram as another window onto the same chat.

The dashboard, the device screen and this bridge all feed the SAME chat turn
(`main.chat_turn`): same brain, same history on disk, same tools. A Telegram
chat shows up in the dashboard's chat list like any other, only its session id
starts with `tg`. What differs is presentation — the brain's `[[msg]]`
bubbles become separate Telegram messages, its reaction becomes a Telegram
reaction on your message, Markdown becomes Telegram HTML.

Who it answers: only paired users. Pairing is a one-time code shown in the
dashboard (`/start CODE`, or the t.me deep link), because a bot token alone
lets anyone on Telegram find the bot and talk to it — and this bot has tools
that read the owner's files.

Transport: long polling with the Bot API over httpx. No webhook, because the
bot usually lives behind NAT on a Pi, and no library, because the dozen calls
used here are simpler than a dependency.
"""

from __future__ import annotations

import asyncio
import logging
import mimetypes
import re
import secrets
import time
import uuid
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional

import httpx

import app_config

from . import batching, formatting, secrets_store
from .locales import pick_lang, t

log = logging.getLogger("virtual_bot.integrations.telegram")

NAME = "telegram"
API = "https://api.telegram.org"
TEXT_LIMIT = 4096
# The Bot API refuses downloads above 20 MB anyway; 10 MB is the vision limit.
MAX_DOWNLOAD = 10 * 1024 * 1024
MAX_TEXT_FILE = 200_000
MAX_TURN_CHARS = 30_000

# ChatHandler(message, session_id, attachments, channel, meta) -> reply dict
ChatHandler = Callable[..., Awaitable[dict]]
# Transcriber(audio bytes, filename, language) -> text
Transcriber = Callable[[bytes, str, str], Awaitable[str]]

# Telegram accepts only these as bot reactions; anything else is an error,
# so the brain's emoji is mapped onto the closest one or skipped.
ALLOWED_REACTIONS = set(
    "👍 👎 ❤ 🔥 🥰 👏 😁 🤔 🤯 😱 🤬 😢 🎉 🤩 🤮 💩 🙏 👌 🕊 🤡 🥱 🥴 😍 🐳 ❤‍🔥 🌚 🌭 💯 🤣 ⚡ 🍌 🏆 💔 🤨 😐 🍓 🍾 💋 🖕 😈 😴 😭 🤓 👻 👨‍💻 👀 🎃 🙈 😇 😨 🤝 ✍ 🤗 🫡 🎅 🎄 ☃ 💅 🤪 🗿 🆒 💘 🙉 🦄 😘 💊 🙊 😎 👾 🤷‍♂ 🤷 🤷‍♀ 😡".split()
)
_REACTION_ALIASES = {"\u2764\ufe0f": "❤", "😂": "🤣", "🙂": "😁", "😊": "🥰", "✅": "👌", "🦀": "🔥", "😅": "😁", "💪": "👏"}


def session_id_for(chat_id: str | int, generation: int = 0) -> str:
    """`tg<chat>` / `tg<chat>-<n>` after /new. Group ids are negative; the
    minus becomes `m` because session ids are path-safe `[A-Za-z0-9_-]`."""
    base = "tg" + str(chat_id).replace("-", "m")
    return base if not generation else f"{base}-{generation}"


class TelegramBridge:
    def __init__(self) -> None:
        self._chat: Optional[ChatHandler] = None
        self._transcribe: Optional[Transcriber] = None
        self._task: Optional[asyncio.Task] = None
        self._client: Optional[httpx.AsyncClient] = None
        self._batcher = batching.TurnBatcher(self._on_turn)
        self._locks: dict[str, asyncio.Lock] = {}
        self._lang: dict[str, str] = {}
        self._last_own: dict[str, int] = {}
        self._stranger_replied: dict[int, float] = {}
        self._me: dict[str, Any] = {}
        self.last_error = ""
        self.running = False

    # ------------------------------------------------------------ wiring

    def attach(self, chat: ChatHandler, transcribe: Optional[Transcriber] = None) -> None:
        self._chat = chat
        self._transcribe = transcribe

    def config(self) -> dict[str, Any]:
        return secrets_store.load(NAME)

    def token(self) -> str:
        import os

        return str(self.config().get("token") or os.environ.get("TELEGRAM_BOT_TOKEN", "")).strip()

    def owners(self) -> list[int]:
        return [int(x) for x in self.config().get("owners", []) if str(x).lstrip("-").isdigit()]

    def status(self) -> dict[str, Any]:
        cfg = self.config()
        token = self.token()
        username = cfg.get("username") or ""
        code = cfg.get("pair_code") or ""
        return {
            "id": NAME,
            "label": "Telegram",
            "configured": bool(token),
            "connected": bool(token) and self.running and not self.last_error,
            "running": self.running,
            "error": self.last_error,
            "account": f"@{username}" if username else "",
            "token": secrets_store.mask(token),
            "owners": len(self.owners()),
            "pair_code": code,
            "pair_link": f"https://t.me/{username}?start={code}" if username and code else "",
            "can_share_files": bool(token) and bool(self.owners()),
        }

    async def configure(self, token: str, clerk_user_id: str = "") -> dict[str, Any]:
        """Check a token with getMe, store it, (re)start polling."""
        token = token.strip()
        if not re.match(r"^\d{5,}:[A-Za-z0-9_-]{30,}$", token):
            raise ValueError("bad_token")
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(f"{API}/bot{token}/getMe")
        data = response.json() if response.headers.get("content-type", "").startswith("application/json") else {}
        if not data.get("ok"):
            raise ValueError("token_rejected")
        me = data["result"]
        cfg = self.config()
        if cfg.get("token") != token:
            # A different bot: old owners paired with a different bot account
            cfg["owners"] = []
            cfg["offset"] = 0
        cfg.update({
            "token": token,
            "username": me.get("username", ""),
            "bot_id": me.get("id"),
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

    # ------------------------------------------------------------ lifecycle

    async def start(self) -> None:
        if self._task and not self._task.done():
            return
        if not self.token():
            return
        self._task = asyncio.create_task(self._poll_forever(), name="telegram-poll")

    async def stop(self) -> None:
        task, self._task = self._task, None
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        await self._batcher.close()
        if self._client:
            await self._client.aclose()
            self._client = None
        self.running = False

    async def restart(self) -> None:
        await self.stop()
        await self.start()

    # ------------------------------------------------------------ Bot API

    async def call(self, method: str, **params: Any) -> Any:
        client = self._client or httpx.AsyncClient(timeout=httpx.Timeout(15, read=65))
        self._client = client
        files = params.pop("_files", None)
        url = f"{API}/bot{self.token()}/{method}"
        if files:
            response = await client.post(url, data={k: str(v) for k, v in params.items()}, files=files)
        else:
            response = await client.post(url, json=params)
        try:
            data = response.json()
        except ValueError:
            raise RuntimeError(f"{method}: HTTP {response.status_code}") from None
        if not data.get("ok"):
            raise TelegramError(method, data.get("error_code", response.status_code), data.get("description", ""))
        return data.get("result")

    async def download(self, file_id: str, limit: int = MAX_DOWNLOAD) -> tuple[bytes, str]:
        info = await self.call("getFile", file_id=file_id)
        if int(info.get("file_size") or 0) > limit:
            raise RuntimeError("file too large")
        path = info.get("file_path") or ""
        client = self._client or httpx.AsyncClient(timeout=30)
        self._client = client
        response = await client.get(f"{API}/file/bot{self.token()}/{path}")
        response.raise_for_status()
        if len(response.content) > limit:
            raise RuntimeError("file too large")
        return response.content, path

    # ------------------------------------------------------------ polling

    async def _poll_forever(self) -> None:
        backoff = 2.0
        try:
            try:
                # A leftover webhook makes getUpdates fail with 409 forever.
                await self.call("deleteWebhook", drop_pending_updates=False)
            except Exception:  # noqa: BLE001 — getUpdates will report the real problem
                pass
            self.running = True
            self.last_error = ""
            while True:
                offset = int(self.config().get("offset") or 0)
                try:
                    updates = await self.call(
                        "getUpdates", offset=offset, timeout=50,
                        allowed_updates=["message", "callback_query"],
                    )
                    backoff = 2.0
                    self.last_error = ""
                except asyncio.CancelledError:
                    raise
                except TelegramError as exc:
                    self.last_error = "conflict" if exc.code == 409 else ("unauthorized" if exc.code == 401 else exc.description[:120])
                    log.warning("Telegram getUpdates failed: %s", exc)
                    if exc.code == 401:
                        return  # a revoked token will not get better by retrying
                    await asyncio.sleep(backoff)
                    backoff = min(backoff * 2, 60)
                    continue
                except Exception as exc:  # noqa: BLE001 — network: retry with backoff
                    self.last_error = "network"
                    log.warning("Telegram polling error: %s: %s", type(exc).__name__, exc)
                    await asyncio.sleep(backoff)
                    backoff = min(backoff * 2, 60)
                    continue
                for update in updates or []:
                    # Advance first: an update that crashes the handler must
                    # not be redelivered on every restart.
                    secrets_store.update(NAME, offset=int(update["update_id"]) + 1)
                    try:
                        await self.handle_update(update)
                    except Exception:  # noqa: BLE001 — one bad update must not stop the bridge
                        log.exception("Telegram update %s failed", update.get("update_id"))
        finally:
            self.running = False

    # ------------------------------------------------------------ updates

    async def handle_update(self, update: dict[str, Any]) -> None:
        if "callback_query" in update:
            await self._on_callback(update["callback_query"])
            return
        msg = update.get("message")
        if not isinstance(msg, dict):
            return
        chat = msg.get("chat") or {}
        sender = msg.get("from") or {}
        if chat.get("type") != "private":
            return  # groups later; a bot in a group must not answer everyone
        user_id = int(sender.get("id") or 0)
        chat_id = str(chat.get("id"))
        lang = pick_lang(sender.get("language_code"))
        self._lang[chat_id] = lang
        text = str(msg.get("text") or msg.get("caption") or "")

        if user_id not in self.owners():
            await self._stranger(chat_id, user_id, text, lang)
            return

        if text.startswith("/"):
            if await self._command(chat_id, user_id, text, lang):
                return

        incoming = await self._to_incoming(chat_id, msg, lang)
        if incoming is None:
            return
        if not incoming.forwarded:
            self._last_own[chat_id] = int(msg.get("message_id") or 0)
        self._batcher.feed(incoming)

    async def _stranger(self, chat_id: str, user_id: int, text: str, lang: str) -> None:
        match = re.match(r"^/(?:start|pair)\s+(\S+)", text.strip())
        code = self.config().get("pair_code") or ""
        if match and code and secrets.compare_digest(match.group(1), code):
            cfg = self.config()
            owners = sorted(set(self.owners()) | {user_id})
            # One-time code: burn it, so a leaked link pairs nobody else.
            secrets_store.update(NAME, owners=owners, pair_code=_new_code())
            log.info("Telegram: paired user %s", user_id)
            await self._send(chat_id, t(lang, "tg.paired"))
            await self._send(chat_id, t(lang, "tg.start"))
            return
        # Answer a stranger at most once an hour: a public bot gets poked,
        # and every reply is an invitation to keep poking.
        now = time.monotonic()
        if now - self._stranger_replied.get(user_id, -1e9) < 3600:
            return
        self._stranger_replied[user_id] = now
        key = "tg.badCode" if match else "tg.notPaired"
        await self._send(chat_id, t(lang, key, id=user_id))

    async def _command(self, chat_id: str, user_id: int, text: str, lang: str) -> bool:
        command = text.split()[0].split("@")[0].lower()
        if command in ("/start", "/help"):
            await self._send(chat_id, t(lang, "tg.start"))
            return True
        if command == "/new":
            self._batcher.drop(chat_id)
            generations = dict(self.config().get("generations") or {})
            generations[chat_id] = int(generations.get(chat_id, 0)) + 1
            secrets_store.update(NAME, generations=generations)
            await self._send(chat_id, t(lang, "tg.new"))
            return True
        if command == "/id":
            await self._send(chat_id, t(lang, "tg.id", id=user_id, chat=chat_id))
            return True
        if command == "/go":
            if not self._batcher.pending(chat_id):
                await self._send(chat_id, t(lang, "tg.nothingHeld"))
            else:
                await self._batcher.flush(chat_id)
            return True
        return False  # unknown command: the brain can read it as text

    async def _to_incoming(self, chat_id: str, msg: dict[str, Any], lang: str) -> Optional[batching.Incoming]:
        text = str(msg.get("text") or msg.get("caption") or "")
        notes: list[str] = []
        attachments: list[dict[str, str]] = []

        if msg.get("photo"):
            sizes = [p for p in msg["photo"] if int(p.get("file_size") or 0) <= MAX_DOWNLOAD]
            if sizes:
                best = max(sizes, key=lambda p: int(p.get("width") or 0))
                saved = await self._save_upload(best["file_id"], ".jpg", "image/jpeg")
                if saved:
                    attachments.append(saved)

        voice = msg.get("voice") or msg.get("audio") or msg.get("video_note")
        if voice:
            duration = formatting.clock(voice.get("duration") or 0)
            transcript = await self._transcribe_voice(voice, lang)
            if transcript:
                text = (text + "\n" + transcript).strip() if text else transcript
                notes.append(t(lang, "tg.voiceNote", duration=duration))
            else:
                notes.append(t(lang, "tg.voiceFailed", duration=duration))

        doc = msg.get("document")
        if doc:
            handled = await self._document(chat_id, doc, lang, forwarded=_is_forward(msg))
            if handled == "consumed":
                return None
            if isinstance(handled, dict):
                attachments.append(handled)
            elif isinstance(handled, str) and handled:
                notes.append(handled)

        if msg.get("sticker"):
            notes.append("sticker " + str(msg["sticker"].get("emoji") or ""))
        if msg.get("location"):
            loc = msg["location"]
            notes.append(f"location {loc.get('latitude')}, {loc.get('longitude')}")
        if msg.get("contact"):
            c = msg["contact"]
            notes.append(f"contact {c.get('first_name', '')} {c.get('phone_number', '')}".strip())
        if msg.get("video"):
            notes.append("video " + formatting.clock(msg["video"].get("duration") or 0))
        if msg.get("poll"):
            poll = msg["poll"]
            options = ", ".join(o.get("text", "") for o in poll.get("options", []))
            notes.append(f"poll: {poll.get('question', '')} ({options})")

        if not (text or notes or attachments):
            return None
        return batching.Incoming(
            chat_id=chat_id,
            message_id=str(msg.get("message_id")),
            text=text,
            forwarded=_is_forward(msg),
            forward_from=_forward_origin(msg),
            sender=(msg.get("from") or {}).get("first_name", ""),
            attachments=attachments,
            notes=notes,
        )

    async def _save_upload(self, file_id: str, suffix: str, mime: str) -> Optional[dict[str, str]]:
        """Download into uploads/, where the chat already reads images from."""
        try:
            data, path = await self.download(file_id)
        except Exception as exc:  # noqa: BLE001 — a missing picture must not drop the message
            log.warning("Telegram download failed: %s", exc)
            return None
        name = f"tg-{uuid.uuid4().hex[:16]}{Path(path).suffix.lower() or suffix}"
        target = Path(app_config.UPLOADS_DIR) / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        return {"url": f"/uploads/{name}", "type": mime, "name": name}

    async def _transcribe_voice(self, voice: dict[str, Any], lang: str) -> str:
        if not self._transcribe:
            return ""
        try:
            data, path = await self.download(voice["file_id"])
            return (await self._transcribe(data, Path(path).name or "voice.ogg", lang)).strip()
        except Exception as exc:  # noqa: BLE001 — fall back to "voice, not transcribed"
            log.warning("Telegram voice transcription failed: %s", exc)
            return ""

    async def _document(self, chat_id: str, doc: dict[str, Any], lang: str, forwarded: bool) -> Any:
        name = str(doc.get("file_name") or "file")
        size = int(doc.get("file_size") or 0)
        mime = str(doc.get("mime_type") or mimetypes.guess_type(name)[0] or "")
        import screen_store

        if name.lower().endswith(screen_store.CBP_SUFFIX):
            await self._import_package(chat_id, doc, lang)
            return "consumed"
        if mime in ("image/png", "image/jpeg", "image/webp", "image/gif") and size <= MAX_DOWNLOAD:
            return await self._save_upload(doc["file_id"], Path(name).suffix or ".png", mime)
        if (mime.startswith("text/") or name.endswith((".md", ".py", ".json", ".csv", ".txt", ".log"))) and size <= MAX_TEXT_FILE:
            try:
                data, _ = await self.download(doc["file_id"], MAX_TEXT_FILE)
                content = data.decode("utf-8", errors="replace")[:20_000]
                return f"{t(lang, 'tg.fileNote', name=name, size=formatting.human_size(size))}:\n{content}"
            except Exception:  # noqa: BLE001 — at least say a file was there
                pass
        return t(lang, "tg.fileNote", name=name, size=formatting.human_size(size))

    async def _import_package(self, chat_id: str, doc: dict[str, Any], lang: str) -> None:
        """A .cbp in the chat is someone sharing a screen app: add it to the
        store, but install only on an explicit tap — it is untrusted code."""
        import screen_store

        try:
            data, _ = await self.download(doc["file_id"], screen_store.MAX_ARCHIVE_BYTES)
            manifest = await asyncio.to_thread(screen_store.import_archive, data, install_now=False)
        except screen_store.StoreError as exc:
            await self._send(chat_id, t(lang, "tg.pkgFailed", error=exc.code))
            return
        except Exception as exc:  # noqa: BLE001
            await self._send(chat_id, t(lang, "tg.pkgFailed", error=type(exc).__name__))
            return
        label = _pkg_label(manifest, lang)
        keyboard = None
        if not manifest.get("installed"):
            keyboard = {"inline_keyboard": [[{"text": t(lang, "tg.pkgInstall"), "callback_data": f"install:{manifest['id']}"}]]}
        await self._send(chat_id, t(lang, "tg.pkgImported", label=label, version=manifest.get("version", "")), reply_markup=keyboard)

    async def _on_callback(self, query: dict[str, Any]) -> None:
        user_id = int((query.get("from") or {}).get("id") or 0)
        data = str(query.get("data") or "")
        try:
            await self.call("answerCallbackQuery", callback_query_id=query.get("id"))
        except Exception:  # noqa: BLE001
            pass
        if user_id not in self.owners() or not data.startswith("install:"):
            return
        import screen_store

        chat_id = str(((query.get("message") or {}).get("chat") or {}).get("id") or user_id)
        lang = pick_lang((query.get("from") or {}).get("language_code"))
        try:
            manifest = await asyncio.to_thread(screen_store.install, data.split(":", 1)[1])
        except screen_store.StoreError as exc:
            await self._send(chat_id, t(lang, "tg.pkgFailed", error=exc.code))
            return
        await self._send(chat_id, t(lang, "tg.pkgInstalled", label=_pkg_label(manifest, lang)))

    # ------------------------------------------------------------ turns

    def session_id(self, chat_id: str) -> str:
        generation = int((self.config().get("generations") or {}).get(chat_id, 0))
        return session_id_for(chat_id, generation)

    async def _on_turn(self, chat_id: str, items: list[batching.Incoming]) -> None:
        lock = self._locks.setdefault(chat_id, asyncio.Lock())
        async with lock:
            lang = self._lang.get(chat_id, "uk")
            own = [m for m in items if not m.forwarded]
            if not own:
                # Only reached through /go with nothing of the user's own.
                pass
            message, attachments = batching.compose(items)
            if len(message) > MAX_TURN_CHARS:
                message = message[:MAX_TURN_CHARS] + "\n[…truncated]"
            reply_to = self._last_own.get(chat_id)
            typing = asyncio.create_task(self._typing(chat_id))
            try:
                if not self._chat:
                    raise RuntimeError("chat is not wired")
                result = await self._chat(
                    message, self.session_id(chat_id), attachments, "telegram",
                    {"clerk_user_id": self.config().get("clerk_user_id", "")},
                )
            except Exception as exc:  # noqa: BLE001 — say it in the chat, not only the log
                log.exception("Telegram turn failed")
                result = {"bubbles": [t(lang, "tg.error", error=type(exc).__name__)]}
            finally:
                typing.cancel()
            await self.deliver(chat_id, result, reply_to)

    async def _typing(self, chat_id: str) -> None:
        # "typing…" lasts 5 s on Telegram's side; a brain turn with tools can
        # take half a minute, so it is renewed until the answer lands.
        try:
            while True:
                try:
                    await self.call("sendChatAction", chat_id=chat_id, action="typing")
                except Exception:  # noqa: BLE001
                    pass
                await asyncio.sleep(4.5)
        except asyncio.CancelledError:
            pass

    async def deliver(self, chat_id: str, result: dict[str, Any], reply_to: Optional[int] = None) -> None:
        """Brain reply -> Telegram: one message per bubble, reaction on yours."""
        bubbles = [b for b in (result.get("bubbles") or []) if str(b).strip()]
        if not bubbles and result.get("reply"):
            bubbles = [result["reply"]]
        reaction = _telegram_reaction(result.get("reaction"))
        if reaction and reply_to:
            try:
                await self.call("setMessageReaction", chat_id=chat_id, message_id=reply_to,
                                reaction=[{"type": "emoji", "emoji": reaction}])
            except Exception:  # noqa: BLE001 — a reaction is decoration
                pass
        first = True
        for bubble in bubbles:
            for chunk in formatting.split_text(str(bubble), TEXT_LIMIT - 200):
                await self._send(chat_id, chunk, markdown=True, reply_to=reply_to if first else None)
                first = False

    async def _send(self, chat_id: str, text: str, *, markdown: bool = False,
                    reply_to: Optional[int] = None, reply_markup: Optional[dict] = None) -> None:
        params: dict[str, Any] = {"chat_id": chat_id, "text": text, "link_preview_options": {"is_disabled": True}}
        if markdown:
            params["text"] = formatting.to_telegram_html(text)
            params["parse_mode"] = "HTML"
        if reply_to:
            params["reply_parameters"] = {"message_id": reply_to, "allow_sending_without_reply": True}
        if reply_markup:
            params["reply_markup"] = reply_markup
        try:
            await self.call("sendMessage", **params)
        except TelegramError as exc:
            if markdown and exc.code == 400:
                # Our HTML was not good enough for Telegram's parser: send the
                # words plain rather than lose the message.
                params.pop("parse_mode", None)
                params["text"] = text
                await self.call("sendMessage", **params)
            else:
                raise

    # ------------------------------------------------------------ outbound

    async def send_to_owners(self, text: str) -> int:
        """For tools and reminders: message every paired owner."""
        sent = 0
        for owner in self.owners():
            await self._send(str(owner), text, markdown=True)
            sent += 1
        return sent

    async def share_package(self, pkg_id: str) -> int:
        """Send a screen package as a .cbp file to the owners' chats."""
        import screen_store

        filename, data = await asyncio.to_thread(screen_store.pack, pkg_id)
        manifest = screen_store.load_manifest(pkg_id) or {"id": pkg_id}
        sent = 0
        for owner in self.owners():
            lang = self._lang.get(str(owner), "uk")
            await self.call(
                "sendDocument", chat_id=owner,
                caption=t(lang, "tg.pkgShared", label=_pkg_label(manifest, lang)),
                _files={"document": (filename, data, screen_store.CBP_MIME)},
            )
            sent += 1
        return sent


class TelegramError(RuntimeError):
    def __init__(self, method: str, code: int, description: str) -> None:
        super().__init__(f"{method}: {code} {description}")
        self.code = int(code or 0)
        self.description = description or ""


def _new_code() -> str:
    # 8 chars of a URL-safe alphabet: short enough to type, far too many
    # combinations to guess one-per-hour.
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(8))


def _is_forward(msg: dict[str, Any]) -> bool:
    return bool(msg.get("forward_origin") or msg.get("forward_date") or msg.get("forward_from")
                or msg.get("forward_from_chat") or msg.get("forward_sender_name"))


def _forward_origin(msg: dict[str, Any]) -> str:
    origin = msg.get("forward_origin") or {}
    kind = origin.get("type")
    if kind == "user":
        user = origin.get("sender_user") or {}
        name = " ".join(filter(None, [user.get("first_name"), user.get("last_name")]))
        return name + (f" (@{user['username']})" if user.get("username") else "")
    if kind == "hidden_user":
        return str(origin.get("sender_user_name") or "hidden user")
    if kind in ("chat", "channel"):
        chat = origin.get("sender_chat") or origin.get("chat") or {}
        title = str(chat.get("title") or "")
        return f"{title} ({kind})" if title else kind
    # Pre-7.0 Bot API fields, still sent by some clients
    if msg.get("forward_from_chat"):
        return str(msg["forward_from_chat"].get("title") or "channel")
    if msg.get("forward_from"):
        return str(msg["forward_from"].get("first_name") or "user")
    return str(msg.get("forward_sender_name") or "")


def _telegram_reaction(emoji: Any) -> str:
    if not emoji:
        return ""
    emoji = str(emoji).replace("\ufe0f", "")
    emoji = _REACTION_ALIASES.get(str(emoji), emoji)
    return emoji if emoji in ALLOWED_REACTIONS else ""


def _pkg_label(manifest: dict[str, Any], lang: str) -> str:
    local = (manifest.get("locales") or {}).get(lang) or {}
    return str(local.get("label") or manifest.get("label") or manifest.get("id", ""))


bridge = TelegramBridge()
