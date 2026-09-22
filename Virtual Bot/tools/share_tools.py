"""
Тули поширення сайтів через Cloudflare Tunnel (див. site_share.py).

Бот каже «опублікуй games/mario як mario» — і сайт одразу доступний за
https://mario.waveio.me. Уся магія Cloudflare (ingress, DNS, перезапуск
cloudflared) — у site_share; тут лише тонкі обгортки для реєстру тулзів.
"""

from __future__ import annotations

import logging

import site_share

log = logging.getLogger("virtual_bot.tools.share")


async def share_site(path: str, slug: str) -> dict:
    return await site_share.share(path, slug)


async def unshare_site(slug: str) -> dict:
    return await site_share.unshare(slug)


async def list_shared_sites() -> dict:
    return site_share.list_shares()


HANDLERS = {
    "share_site": share_site,
    "unshare_site": unshare_site,
    "list_shared_sites": list_shared_sites,
}
