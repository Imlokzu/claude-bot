"""
Тулза «Пошук картинок»: DuckDuckGo Images, без ключа.

DDG не має відкритого API для картинок: спершу треба взяти одноразовий токен
`vqd` зі звичайної сторінки пошуку, і лише потім питати i.js. Тому тут два
запити, а не один — і саме тому токен НЕ кешується надовго: він протухає.
"""

from __future__ import annotations

import logging
import re
from urllib.parse import quote_plus

import httpx

log = logging.getLogger("virtual_bot.tools.images")

_TOKEN_URL = "https://duckduckgo.com/"
_IMAGES_URL = "https://duckduckgo.com/i.js"

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "uk-UA,uk;q=0.9,en;q=0.8",
    "Referer": "https://duckduckgo.com/",
}

# vqd приходить у розмітці в кількох варіантах лапок — ловимо всі
_VQD_RE = re.compile(r"vqd=[\"']?([\w-]+)[\"']?")

MAX_COUNT = 6


async def _fetch_vqd(client: httpx.AsyncClient, query: str) -> str | None:
    resp = await client.get(f"{_TOKEN_URL}?q={quote_plus(query)}&iax=images&ia=images")
    resp.raise_for_status()
    match = _VQD_RE.search(resp.text)
    return match.group(1) if match else None


async def search_images(query: str, count: int = 3) -> dict:
    """
    Шукає картинки. Повертає {"query", "images": [{"title","image","thumbnail","source"}]}
    або {"error": ...}.
    """
    query = (query or "").strip()
    if not query:
        return {"error": "Вкажи, що шукати"}
    count = max(1, min(int(count or 3), MAX_COUNT))

    try:
        async with httpx.AsyncClient(timeout=15.0, headers=_HEADERS, follow_redirects=True) as client:
            vqd = await _fetch_vqd(client, query)
            if not vqd:
                return {"error": "Не вдалося отримати токен пошуку картинок"}
            resp = await client.get(
                _IMAGES_URL,
                params={"l": "uk-ua", "o": "json", "q": query, "vqd": vqd, "f": ",,,", "p": "1"},
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:  # noqa: BLE001 — мережа/розмітка DDG можуть змінитись
        log.warning("Пошук картинок не вдався: %s", type(exc).__name__)
        return {"error": "Не вдалося знайти картинки"}

    images = []
    for item in (data.get("results") or [])[:count]:
        url = item.get("image")
        if not isinstance(url, str) or not url.startswith("https://"):
            continue  # у чат вставляємо лише https, інакше картинка не завантажиться
        images.append({
            "title": (item.get("title") or "")[:160],
            "image": url,
            "thumbnail": item.get("thumbnail") or url,
            "source": item.get("url") or "",
            "width": item.get("width"),
            "height": item.get("height"),
        })

    if not images:
        return {"error": f"Нічого не знайшлось за запитом «{query}»"}
    return {"query": query, "images": images}
