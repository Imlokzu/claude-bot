"""
Google account: Calendar and Gmail for the bot's tools.

OAuth 2.0 "installed app" flow with PKCE and a loopback redirect to this
server, which is what Google allows for a program running on someone's own
machine. The owner creates a *Desktop app* OAuth client in Google Cloud and
pastes its id and secret into the dashboard once; after consent, the refresh
token lives in runtime/integrations/google.json (0600, git-ignored).

Scopes are the least that makes the tools useful: calendar events read and
write, Gmail read-only. The bot can look at mail; it cannot send or delete
any.
"""

from __future__ import annotations

import base64
import hashlib
import logging
import os
import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from urllib.parse import urlencode

import httpx

from . import secrets_store

log = logging.getLogger("virtual_bot.integrations.google")

NAME = "google"
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
SCOPES = [
    "openid",
    "email",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/gmail.readonly",
]
_PENDING: dict[str, tuple[float, str, str]] = {}  # state -> (created, verifier, redirect_uri)
_PENDING_TTL_S = 900


class GoogleError(RuntimeError):
    def __init__(self, message: str, code: str = "google_error") -> None:
        super().__init__(message)
        self.code = code


class GoogleAccount:
    def config(self) -> dict[str, Any]:
        return secrets_store.load(NAME)

    def client(self) -> tuple[str, str]:
        cfg = self.config()
        return (
            str(cfg.get("client_id") or os.environ.get("GOOGLE_CLIENT_ID", "")).strip(),
            str(cfg.get("client_secret") or os.environ.get("GOOGLE_CLIENT_SECRET", "")).strip(),
        )

    def status(self) -> dict[str, Any]:
        cfg = self.config()
        client_id, _secret = self.client()
        return {
            "id": NAME,
            "label": "Google",
            "configured": bool(client_id),
            "connected": bool(cfg.get("refresh_token")),
            "running": bool(cfg.get("refresh_token")),
            "error": cfg.get("last_error", ""),
            "account": cfg.get("email", ""),
            "scopes": ["calendar", "gmail.readonly"] if cfg.get("refresh_token") else [],
            "can_share_files": False,
        }

    def set_client(self, client_id: str, client_secret: str) -> None:
        client_id, client_secret = client_id.strip(), client_secret.strip()
        if not client_id.endswith(".apps.googleusercontent.com") or not client_secret:
            raise GoogleError("client id must end with .apps.googleusercontent.com", "bad_client")
        secrets_store.update(NAME, client_id=client_id, client_secret=client_secret)

    def auth_url(self, redirect_uri: str) -> str:
        """Consent URL. PKCE even with a client secret: a Desktop client's
        secret is not really secret, the verifier is."""
        client_id, _secret = self.client()
        if not client_id:
            raise GoogleError("set the OAuth client first", "not_configured")
        now = time.monotonic()
        for key in [k for k, v in _PENDING.items() if now - v[0] > _PENDING_TTL_S]:
            _PENDING.pop(key, None)
        state = secrets.token_urlsafe(24)
        verifier = secrets.token_urlsafe(64)
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
        _PENDING[state] = (now, verifier, redirect_uri)
        return AUTH_URL + "?" + urlencode({
            "client_id": client_id, "redirect_uri": redirect_uri, "response_type": "code",
            "scope": " ".join(SCOPES), "state": state, "access_type": "offline",
            # consent every time: without it Google omits the refresh token
            # on a second connect, and the login silently dies in an hour.
            "prompt": "consent", "code_challenge": challenge, "code_challenge_method": "S256",
        })

    async def finish(self, state: str, code: str) -> dict[str, Any]:
        pending = _PENDING.pop(state or "", None)
        if not pending or time.monotonic() - pending[0] > _PENDING_TTL_S:
            raise GoogleError("login expired, start again", "bad_state")
        _created, verifier, redirect_uri = pending
        client_id, client_secret = self.client()
        async with httpx.AsyncClient(timeout=20) as http:
            response = await http.post(TOKEN_URL, data={
                "code": code, "client_id": client_id, "client_secret": client_secret,
                "redirect_uri": redirect_uri, "grant_type": "authorization_code", "code_verifier": verifier,
            })
        data = response.json() if response.content else {}
        if response.status_code != 200 or not data.get("refresh_token"):
            raise GoogleError(str(data.get("error_description") or data.get("error") or "token exchange failed"), "exchange_failed")
        email = _email_from_id_token(data.get("id_token", ""))
        secrets_store.update(
            NAME, refresh_token=data["refresh_token"], access_token=data.get("access_token"),
            expires_at=time.time() + int(data.get("expires_in") or 3600) - 60, email=email, last_error=None,
        )
        log.info("Google connected as %s", email or "(unknown)")
        return self.status()

    async def disconnect(self) -> None:
        cfg = self.config()
        token = cfg.get("refresh_token")
        if token:
            try:
                async with httpx.AsyncClient(timeout=10) as http:
                    await http.post("https://oauth2.googleapis.com/revoke", data={"token": token})
            except Exception:  # noqa: BLE001 — forget it locally regardless
                pass
        keep = {k: cfg[k] for k in ("client_id", "client_secret") if k in cfg}
        secrets_store.save(NAME, keep)

    async def _access_token(self) -> str:
        cfg = self.config()
        if not cfg.get("refresh_token"):
            raise GoogleError("Google is not connected", "not_connected")
        if cfg.get("access_token") and float(cfg.get("expires_at") or 0) > time.time():
            return str(cfg["access_token"])
        client_id, client_secret = self.client()
        async with httpx.AsyncClient(timeout=20) as http:
            response = await http.post(TOKEN_URL, data={
                "client_id": client_id, "client_secret": client_secret,
                "refresh_token": cfg["refresh_token"], "grant_type": "refresh_token",
            })
        data = response.json() if response.content else {}
        if response.status_code != 200:
            secrets_store.update(NAME, last_error="refresh_failed")
            raise GoogleError("Google login expired — reconnect in the panel", "refresh_failed")
        secrets_store.update(NAME, access_token=data["access_token"],
                             expires_at=time.time() + int(data.get("expires_in") or 3600) - 60, last_error=None)
        return str(data["access_token"])

    async def api(self, method: str, url: str, **kwargs: Any) -> Any:
        token = await self._access_token()
        async with httpx.AsyncClient(timeout=20) as http:
            response = await http.request(method, url, headers={"Authorization": f"Bearer {token}"}, **kwargs)
        if response.status_code >= 400:
            raise GoogleError(f"Google API {response.status_code}: {response.text[:200]}", "api_error")
        return response.json() if response.content else {}

    # ------------------------------------------------------------ calendar

    async def upcoming(self, days: int = 7, limit: int = 10) -> list[dict[str, Any]]:
        now = datetime.now(timezone.utc)
        data = await self.api("GET", "https://www.googleapis.com/calendar/v3/calendars/primary/events", params={
            "timeMin": now.isoformat(), "timeMax": (now + timedelta(days=max(1, min(days, 60)))).isoformat(),
            "singleEvents": "true", "orderBy": "startTime", "maxResults": max(1, min(limit, 50)),
        })
        out = []
        for item in data.get("items") or []:
            start = item.get("start") or {}
            end = item.get("end") or {}
            out.append({
                "title": item.get("summary") or "",
                "start": start.get("dateTime") or start.get("date"),
                "end": end.get("dateTime") or end.get("date"),
                "all_day": "date" in start,
                "where": item.get("location") or "",
                "link": item.get("htmlLink") or "",
            })
        return out

    async def add_event(self, title: str, start: str, end: str = "", minutes: int = 60,
                        where: str = "", tz: str = "Europe/Kyiv") -> dict[str, Any]:
        try:
            begins = datetime.fromisoformat(start)
        except ValueError as exc:
            raise GoogleError("start must be ISO 8601, e.g. 2026-09-30T15:00", "bad_request") from exc
        ends = datetime.fromisoformat(end) if end else begins + timedelta(minutes=max(5, min(minutes, 24 * 60)))
        body = {
            "summary": title[:300],
            "location": where[:300],
            "start": {"dateTime": begins.isoformat(), "timeZone": tz},
            "end": {"dateTime": ends.isoformat(), "timeZone": tz},
        }
        event = await self.api("POST", "https://www.googleapis.com/calendar/v3/calendars/primary/events", json=body)
        return {"ok": True, "title": event.get("summary"), "start": (event.get("start") or {}).get("dateTime"), "link": event.get("htmlLink")}

    # ------------------------------------------------------------ gmail

    async def mail_search(self, query: str, limit: int = 5) -> list[dict[str, Any]]:
        base = "https://gmail.googleapis.com/gmail/v1/users/me/messages"
        listing = await self.api("GET", base, params={"q": query[:300], "maxResults": max(1, min(limit, 20))})
        out = []
        for ref in listing.get("messages") or []:
            msg = await self.api("GET", f"{base}/{ref['id']}", params=[
                ("format", "metadata"), ("metadataHeaders", "Subject"),
                ("metadataHeaders", "From"), ("metadataHeaders", "Date"),
            ])
            headers = {h["name"].lower(): h["value"] for h in (msg.get("payload") or {}).get("headers") or []}
            out.append({
                "id": ref["id"], "from": headers.get("from", ""), "subject": headers.get("subject", ""),
                "date": headers.get("date", ""), "snippet": msg.get("snippet", ""),
                "unread": "UNREAD" in (msg.get("labelIds") or []),
            })
        return out

    async def mail_read(self, message_id: str, max_chars: int = 8000) -> dict[str, Any]:
        if not message_id.isalnum():
            raise GoogleError("bad message id", "bad_request")
        msg = await self.api("GET", f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{message_id}", params={"format": "full"})
        payload = msg.get("payload") or {}
        headers = {h["name"].lower(): h["value"] for h in payload.get("headers") or []}
        return {
            "from": headers.get("from", ""), "to": headers.get("to", ""),
            "subject": headers.get("subject", ""), "date": headers.get("date", ""),
            "text": _plain_text(payload)[:max_chars],
        }


def _email_from_id_token(token: str) -> str:
    """The id_token came straight from Google over TLS in the token response,
    so reading its payload without verifying the signature is fine here."""
    try:
        import json

        part = token.split(".")[1]
        part += "=" * (-len(part) % 4)
        return str(json.loads(base64.urlsafe_b64decode(part)).get("email") or "")
    except Exception:  # noqa: BLE001
        return ""


def _plain_text(part: dict[str, Any]) -> str:
    """First text/plain body in a MIME tree; stripped HTML as a fallback."""
    import html as html_lib
    import re

    def decode(data: str) -> str:
        return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4)).decode("utf-8", errors="replace")

    stack = [part]
    html_body = ""
    while stack:
        node = stack.pop(0)
        mime = node.get("mimeType", "")
        data = (node.get("body") or {}).get("data")
        if data and mime == "text/plain":
            return decode(data)
        if data and mime == "text/html" and not html_body:
            html_body = decode(data)
        stack.extend(node.get("parts") or [])
    text = re.sub(r"<(script|style).*?</\1>", " ", html_body, flags=re.S | re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", html_lib.unescape(text)).strip()


account = GoogleAccount()
