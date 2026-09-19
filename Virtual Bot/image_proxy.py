"""
Проксі картинок для панелі.

Потрібне рівно для однієї речі — кнопки «Завантажити» в переглядачі. Картинки
в чат приходять із чужих хостів (пошук DDG), і браузер із ними безсилий:
`<a download>` на інший домен просто переходить за посиланням замість
збереження, а `fetch()` падає на CORS. Тому байти тягне бот і віддає їх уже
зі свого походження — заодно хост картинки не бачить ні IP пристрою, ні
Referer панелі.

Оскільки адреса приходить ЗЗОВНІ (її написала модель), тут є перевірки проти
SSRF: лише http/https, і жодна з адрес, у які резолвиться хост, не сміє бути
локальною — інакше через цю ручку можна було б читати сусідні сервіси на
127.0.0.1. Перевірка робиться до запиту; гонку «зарезолвилось у біле, поки
йшов запит — стало сіре» вона не ловить, але для панелі на локальній машині
цього достатньо.
"""

from __future__ import annotations

import ipaddress
import logging
import socket
from urllib.parse import urlparse

import httpx

log = logging.getLogger("virtual_bot.image_proxy")

# 20 МіБ — із запасом на будь-яке фото з пошуку й водночас не дає одним
# запитом з'їсти пам'ять процесу.
MAX_BYTES = 20 * 1024 * 1024
TIMEOUT_S = 15.0

_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


class ImageProxyError(Exception):
    """Адресу не можна брати або хост не віддав картинку."""

    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status = status


def _is_public(address: str) -> bool:
    """Чи адреса — звичайний інтернет, а не щось своє під боком."""
    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        return False
    return not (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


def check_url(url: str) -> str:
    """Перевіряє адресу й повертає її ж. Кидає ImageProxyError, якщо не можна."""
    parsed = urlparse((url or "").strip())
    if parsed.scheme not in ("http", "https"):
        raise ImageProxyError("Підтримуються лише http і https")
    host = parsed.hostname
    if not host:
        raise ImageProxyError("В адресі немає хоста")
    try:
        infos = socket.getaddrinfo(host, parsed.port or (443 if parsed.scheme == "https" else 80))
    except OSError:
        raise ImageProxyError("Хост не резолвиться", status=502) from None
    addresses = {info[4][0] for info in infos}
    if not addresses or not all(_is_public(address) for address in addresses):
        raise ImageProxyError("Адреса веде на локальну мережу")
    return url


async def fetch(url: str) -> tuple[bytes, str]:
    """Тягне картинку. Повертає (байти, content-type)."""
    check_url(url)
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_S, follow_redirects=True) as client:
            async with client.stream("GET", url, headers={"User-Agent": _UA}) as resp:
                if resp.status_code != 200:
                    raise ImageProxyError(f"Хост відповів HTTP {resp.status_code}", status=502)
                media = (resp.headers.get("content-type") or "").split(";")[0].strip().lower()
                if not media.startswith("image/"):
                    raise ImageProxyError("За адресою не картинка", status=415)
                chunks: list[bytes] = []
                size = 0
                async for chunk in resp.aiter_bytes():
                    size += len(chunk)
                    if size > MAX_BYTES:
                        raise ImageProxyError("Картинка завелика", status=413)
                    chunks.append(chunk)
    except ImageProxyError:
        raise
    except Exception as exc:  # noqa: BLE001 — мережа/таймаут: це відповідь, а не збій панелі
        log.info("Картинка %s не завантажилась (%s)", url, type(exc).__name__)
        raise ImageProxyError("Картинку не вдалось завантажити", status=502) from exc
    return b"".join(chunks), media
