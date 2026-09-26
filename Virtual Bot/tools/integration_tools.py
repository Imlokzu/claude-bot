"""
Brain tools backed by the built-in integrations (see integrations/).

Each tool fails soft with a plain reason ("Google is not connected — the
owner can connect it in the panel → Integrations"), so the model can say
what is missing instead of pretending it looked.
"""

from __future__ import annotations

import logging

import integrations
from integrations import google

log = logging.getLogger("virtual_bot.tools.integrations")


def _google_error(exc: Exception) -> dict:
    code = getattr(exc, "code", "")
    if code in ("not_connected", "not_configured"):
        return {"error": "Google is not connected. The owner can connect it in the panel → Integrations → Google."}
    if code == "refresh_failed":
        return {"error": "The Google login expired. The owner needs to reconnect it in the panel → Integrations."}
    return {"error": f"Google request failed: {exc}"}


async def notify_owner(text: str) -> dict:
    text = (text or "").strip()
    if not text:
        return {"error": "Nothing to send."}
    sent = await integrations.notify_owner(text[:3500])
    if not sent:
        return {"error": "No messenger is connected (Telegram or Discord). The owner can connect one in the panel → Integrations."}
    return {"ok": True, "sent_via": sorted(sent)}


async def calendar_upcoming(days: str = "7") -> dict:
    try:
        events = await google.account.upcoming(int(days or 7))
    except (google.GoogleError, ValueError) as exc:
        return _google_error(exc)
    return {"ok": True, "events": events, "count": len(events)}


async def calendar_add(title: str, start: str, minutes: str = "60", where: str = "") -> dict:
    if not (title or "").strip():
        return {"error": "The event needs a title."}
    try:
        return await google.account.add_event(title.strip(), start.strip(), minutes=int(minutes or 60), where=where or "")
    except (google.GoogleError, ValueError) as exc:
        return _google_error(exc)


async def gmail_search(query: str = "is:unread", limit: str = "5") -> dict:
    try:
        found = await google.account.mail_search(query or "is:unread", int(limit or 5))
    except (google.GoogleError, ValueError) as exc:
        return _google_error(exc)
    return {"ok": True, "messages": found, "count": len(found)}


async def gmail_read(message_id: str) -> dict:
    try:
        return {"ok": True, **(await google.account.mail_read((message_id or "").strip()))}
    except (google.GoogleError, ValueError) as exc:
        return _google_error(exc)


def _fn(name: str, description: str, properties: dict, required: list[str]) -> dict:
    return {"type": "function", "function": {
        "name": name, "description": description,
        "parameters": {"type": "object", "properties": properties, "required": required},
    }}


SCHEMAS: list[dict] = [
    _fn("notify_owner",
        "Send the owner a message in their messenger (Telegram/Discord) — for reminders, results of a long task, "
        "or when they ask 'send it to my Telegram'.",
        {"text": {"type": "string", "description": "The message text (Markdown allowed)."}}, ["text"]),
    _fn("calendar_upcoming",
        "List the owner's upcoming Google Calendar events.",
        {"days": {"type": "string", "description": "How many days ahead, default 7."}}, []),
    _fn("calendar_add",
        "Add an event to the owner's Google Calendar. Ask for the time if it is unclear.",
        {"title": {"type": "string", "description": "Event title."},
         "start": {"type": "string", "description": "Local start time, ISO 8601, e.g. 2026-09-30T15:00."},
         "minutes": {"type": "string", "description": "Duration in minutes, default 60."},
         "where": {"type": "string", "description": "Place, optional."}}, ["title", "start"]),
    _fn("gmail_search",
        "Search the owner's Gmail (read-only). Uses Gmail search syntax: 'is:unread', 'from:bank', 'newer_than:2d'.",
        {"query": {"type": "string", "description": "Gmail search query, default is:unread."},
         "limit": {"type": "string", "description": "How many, default 5."}}, []),
    _fn("gmail_read",
        "Read one Gmail message by id (from gmail_search).",
        {"message_id": {"type": "string", "description": "Message id."}}, ["message_id"]),
]

HANDLERS = {
    "notify_owner": notify_owner,
    "calendar_upcoming": calendar_upcoming,
    "calendar_add": calendar_add,
    "gmail_search": gmail_search,
    "gmail_read": gmail_read,
}
