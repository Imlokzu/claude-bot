"""
Klod Bot — tunnel guard: a password in front of the bot when it leaves the LAN.

The bot itself has no access control. The launcher starts it with
CLERK_DISABLED=1 (launcher/main.go), so every endpoint answers without a
token — fine while it only listens on a home network, fatal the moment a
tunnel gives it a public address. Chat, the workspace, the file tools and the
OpenClaw tool switches would all be one URL away from anyone.

This sits in front and demands a shared secret before forwarding anything.

Why a cookie and not Basic auth: the panel's event stream is an EventSource,
which cannot send headers (see dashboard/src/lib/auth.ts), and an Android
WebView silently refuses a Basic auth challenge rather than prompting. A
cookie is sent automatically by both, so one unlock in the browser covers the
panel, its event stream and the app alike.

Run it beside the bot and point the tunnel here instead of at port 8100:

    .venv/bin/python -m uvicorn tunnel_guard:app --port 8123
"""

from __future__ import annotations

import os
import secrets

import httpx
from starlette.applications import Starlette
from starlette.background import BackgroundTask
from starlette.requests import Request
from starlette.responses import PlainTextResponse, RedirectResponse, Response, StreamingResponse
from starlette.routing import Route

UPSTREAM = os.environ.get("GUARD_UPSTREAM", "http://127.0.0.1:8100")
SECRET = os.environ.get("GUARD_SECRET", "")
COOKIE = "klodbot_pass"

# Headers that describe one hop and must not be copied onto the next, plus
# the length/encoding pair, which httpx recomputes for the body we resend.
HOP = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade",
    "content-length", "content-encoding", "host",
}

# No read timeout: a chat turn streams for as long as the model thinks, and
# the event stream stays open indefinitely. Cutting either at a fixed
# deadline would look like the bot dying mid-sentence.
client = httpx.AsyncClient(
    base_url=UPSTREAM,
    timeout=httpx.Timeout(30.0, read=None, write=30.0, pool=30.0),
    follow_redirects=False,
)


def _authorised(request: Request) -> bool:
    if not SECRET:
        return False
    given = (
        request.cookies.get(COOKIE)
        or request.query_params.get("key")
        or request.headers.get("x-klod-key")
        or ""
    )
    # Constant time: a plain == leaks the secret one character at a time to
    # anyone who can measure the reply.
    return secrets.compare_digest(given, SECRET)


async def proxy(request: Request) -> Response:
    if not _authorised(request):
        return PlainTextResponse("Потрібен ключ доступу.", status_code=401)

    # The key arriving in the URL is the unlock step: store it and strip it
    # back out, so it stops travelling in every later request and in the
    # address bar, where it would end up in history and in screenshots.
    if request.query_params.get("key") and not request.cookies.get(COOKIE):
        remainder = [
            f"{name}={value}"
            for name, value in request.query_params.multi_items()
            if name != "key"
        ]
        target = request.url.path + (("?" + "&".join(remainder)) if remainder else "")
        response = RedirectResponse(target, status_code=303)
        response.set_cookie(
            COOKIE, SECRET,
            max_age=60 * 60 * 24 * 30, httponly=True, samesite="lax",
            # Cloudflare terminates TLS and forwards plain HTTP, so trust the
            # forwarded scheme; marking the cookie Secure over a LAN request
            # would stop the browser storing it at all.
            secure=request.headers.get("x-forwarded-proto", "") == "https",
            path="/",
        )
        return response

    headers = {k: v for k, v in request.headers.items() if k.lower() not in HOP}
    upstream = client.build_request(
        request.method,
        request.url.path,
        params=request.query_params,
        headers=headers,
        content=request.stream(),
    )
    reply = await client.send(upstream, stream=True)

    passed = {k: v for k, v in reply.headers.items() if k.lower() not in HOP}
    return StreamingResponse(
        reply.aiter_raw(),
        status_code=reply.status_code,
        headers=passed,
        # Without this the upstream connection is never released and the
        # pool drains after a few streamed replies.
        background=BackgroundTask(reply.aclose),
    )


app = Starlette(routes=[
    Route("/{path:path}", proxy, methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]),
])
