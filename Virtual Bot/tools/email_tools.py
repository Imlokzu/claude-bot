"""
Agent Email Tools for Virtual Bot.
Provides mailbox management, email reading, and automated OTP/verification code extraction
via Cloudflare Email Routing Worker at mail.waveio.me.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
from typing import Any

import httpx

log = logging.getLogger("virtual_bot.tools.email")

DEFAULT_API_URL = "https://mail.waveio.me"
DEFAULT_API_KEY = "agmail_secret_lokzu_2026"
DEFAULT_DOMAIN = "ag.waveio.me"


def _get_config() -> tuple[str, str, str]:
    api_url = os.getenv("AGENT_MAIL_API_URL", DEFAULT_API_URL).rstrip("/")
    api_key = os.getenv("AGENT_MAIL_API_KEY", DEFAULT_API_KEY)
    domain = os.getenv("AGENT_MAIL_DOMAIN", DEFAULT_DOMAIN).strip()
    return api_url, api_key, domain


def _normalize_address(agent_name_or_email: str, domain: str) -> str:
    cleaned = (agent_name_or_email or "lokzu").strip().lower()
    if "@" in cleaned:
        return cleaned
    cleaned = re.sub(r"[^a-z0-9._-]", "", cleaned)
    return f"{cleaned}@{domain}"


async def get_agent_email(agent_name: str = "lokzu") -> dict[str, Any]:
    """
    Get the designated email address for the agent to use during signups or correspondence.
    """
    _, _, domain = _get_config()
    address = _normalize_address(agent_name, domain)
    return {
        "status": "ok",
        "agent_name": agent_name,
        "email": address,
        "domain": domain,
        "description": f"Use this email address for service registrations and receiving OTP codes.",
    }


async def check_agent_inbox(agent_name: str = "lokzu") -> dict[str, Any]:
    """
    Check recent incoming emails for the agent mailbox.
    """
    api_url, api_key, domain = _get_config()
    target_email = _normalize_address(agent_name, domain)

    headers = {"X-API-Key": api_key}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{api_url}/api/inbox",
                params={"to": target_email},
                headers=headers,
            )
            if resp.status_code != 200:
                return {
                    "status": "error",
                    "code": resp.status_code,
                    "error": f"Mail worker returned {resp.status_code}: {resp.text}",
                }
            data = resp.json()
            return {
                "status": "ok",
                "email": target_email,
                "count": data.get("count", 0),
                "messages": data.get("messages", []),
            }
    except Exception as exc:
        log.warning("Failed to check agent inbox: %s", exc)
        return {
            "status": "error",
            "email": target_email,
            "error": str(exc),
        }


async def wait_for_otp_code(
    agent_name: str = "lokzu",
    service: str = "",
    max_wait_seconds: int = 40,
) -> dict[str, Any]:
    """
    Wait and poll for an incoming OTP/verification code or link for this mailbox.
    """
    api_url, api_key, domain = _get_config()
    target_email = _normalize_address(agent_name, domain)

    headers = {"X-API-Key": api_key}
    poll_interval = 3
    deadline = asyncio.get_event_loop().time() + max(5, min(max_wait_seconds, 120))

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            while asyncio.get_event_loop().time() < deadline:
                resp = await client.get(
                    f"{api_url}/api/latest-otp",
                    params={"to": target_email},
                    headers=headers,
                )
                if resp.status_code == 200:
                    payload = resp.json()
                    otp_data = payload.get("otp")
                    if otp_data and otp_data.get("code"):
                        # If specific service filter requested, check subject/from
                        if service:
                            needle = service.lower()
                            subj = (otp_data.get("subject") or "").lower()
                            sender = (otp_data.get("from") or "").lower()
                            if needle not in subj and needle not in sender:
                                await asyncio.sleep(poll_interval)
                                continue

                        return {
                            "status": "ok",
                            "found": True,
                            "email": target_email,
                            "otp_code": otp_data.get("code"),
                            "verification_link": otp_data.get("link"),
                            "from": otp_data.get("from"),
                            "subject": otp_data.get("subject"),
                            "received_at": otp_data.get("received_at"),
                        }

                await asyncio.sleep(poll_interval)

            return {
                "status": "timeout",
                "found": False,
                "email": target_email,
                "message": f"No verification code arrived within {max_wait_seconds} seconds.",
            }
    except Exception as exc:
        log.warning("Failed while waiting for OTP: %s", exc)
        return {
            "status": "error",
            "email": target_email,
            "error": str(exc),
        }


async def send_agent_email(
    to: str,
    subject: str,
    body: str,
    sender_name: str = "Claude Bot",
) -> dict[str, Any]:
    """
    Send an email to any recipient using the configured Brevo outbound API.
    """
    brevo_api_key = os.getenv("BREVO_API_KEY", "")
    if not brevo_api_key:
        return {"status": "error", "error": "BREVO_API_KEY is not configured in .env"}

    sender_email = os.getenv("BREVO_SENDER_EMAIL", "Lokzuhd@gmail.com")
    payload = {
        "sender": {"name": sender_name, "email": sender_email},
        "to": [{"email": to.strip()}],
        "subject": subject,
        "textContent": body,
    }

    headers = {
        "api-key": brevo_api_key,
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post("https://api.brevo.com/v3/smtp/email", headers=headers, json=payload)
            if resp.status_code in (200, 201):
                data = resp.json()
                return {
                    "status": "ok",
                    "sent": True,
                    "to": to,
                    "message_id": data.get("messageId"),
                    "subject": subject,
                }
            return {
                "status": "error",
                "code": resp.status_code,
                "error": f"Brevo returned error {resp.status_code}: {resp.text}",
            }
    except Exception as exc:
        log.warning("Failed to send email via Brevo: %s", exc)
        return {"status": "error", "error": str(exc)}


SCHEMAS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "get_agent_email",
            "description": "Отримати власну поштову адресу агента (@ag.waveio.me) для реєстрації на зовнішніх сервісах чи отримання пошти.",
            "parameters": {
                "type": "object",
                "properties": {
                    "agent_name": {
                        "type": "string",
                        "description": "Ім'я або псевдонім скриньки (типово 'lokzu').",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "check_agent_inbox",
            "description": "Перевірити вхідні листи в поштовій скриньці агента, прочитати листи, теми, та розпізнані коди.",
            "parameters": {
                "type": "object",
                "properties": {
                    "agent_name": {
                        "type": "string",
                        "description": "Ім'я або адреса скриньки (типово 'lokzu').",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "wait_for_otp_code",
            "description": "Очікувати на надходження коду підтвердження (OTP / verification code) або посилання активації від сервісу після реєстрації/входу.",
            "parameters": {
                "type": "object",
                "properties": {
                    "agent_name": {
                        "type": "string",
                        "description": "Ім'я або адреса скриньки (типово 'lokzu').",
                    },
                    "service": {
                        "type": "string",
                        "description": "Назва сервісу або ключове слово для фільтрації (напр. 'github', 'anthropic', 'opencode').",
                    },
                    "max_wait_seconds": {
                        "type": "integer",
                        "description": "Скільки секунд очікувати на лист (типово 40).",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "send_agent_email",
            "description": "Надіслати електронний лист від імені бота чи агента на будь-яку адресу (наприклад, власнику або зовнішньому контакту).",
            "parameters": {
                "type": "object",
                "properties": {
                    "to": {
                        "type": "string",
                        "description": "Електронна адреса одержувача (напр. 'lokzuhd@gmail.com').",
                    },
                    "subject": {
                        "type": "string",
                        "description": "Тема листа.",
                    },
                    "body": {
                        "type": "string",
                        "description": "Текст повідомлення.",
                    },
                },
                "required": ["to", "subject", "body"],
            },
        },
    },
]

HANDLERS = {
    "get_agent_email": get_agent_email,
    "check_agent_inbox": check_agent_inbox,
    "wait_for_otp_code": wait_for_otp_code,
    "send_agent_email": send_agent_email,
}


