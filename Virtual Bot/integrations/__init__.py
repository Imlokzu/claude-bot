"""
Built-in integrations: the bot's accounts on other services.

- telegram — the chat, in Telegram (a paired owner only)
- discord  — the chat, in Discord DMs and mentions
- google   — Calendar and Gmail for the brain's tools

Messengers are windows onto the same chat (see integrations.telegram), so
they share one contract: `attach(chat_handler, transcriber)`, `start()`,
`stop()`, `status()`, `configure(token)`, `send_to_owners(text)`,
`share_package(pkg_id)`. Secrets live in runtime/integrations/ via
secrets_store, never in the repository.
"""

from __future__ import annotations

import logging
from typing import Any

from . import discord, google, telegram

log = logging.getLogger("virtual_bot.integrations")

MESSENGERS = {"telegram": telegram.bridge, "discord": discord.bridge}


def statuses() -> list[dict[str, Any]]:
    out = []
    for bridge in MESSENGERS.values():
        out.append(bridge.status())
    out.append(google.account.status())
    return out


async def start_all(chat_handler, transcriber=None) -> None:
    for name, bridge in MESSENGERS.items():
        bridge.attach(chat_handler, transcriber)
        try:
            await bridge.start()
        except Exception:  # noqa: BLE001 — one integration must not block the server start
            log.exception("Integration %s failed to start", name)


async def stop_all() -> None:
    for name, bridge in MESSENGERS.items():
        try:
            await bridge.stop()
        except Exception:  # noqa: BLE001
            log.exception("Integration %s failed to stop", name)


async def notify_owner(text: str) -> dict[str, int]:
    """Send a message to the owner on every connected messenger."""
    sent: dict[str, int] = {}
    for name, bridge in MESSENGERS.items():
        if bridge.token() and bridge.owners():
            try:
                sent[name] = await bridge.send_to_owners(text)
            except Exception as exc:  # noqa: BLE001 — try the others
                log.warning("notify via %s failed: %s", name, exc)
    return sent
