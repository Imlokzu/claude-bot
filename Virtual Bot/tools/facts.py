"""
Тулза «Факти»: Wikipedia REST API + search, без ключа.
"""

from __future__ import annotations

import logging
from urllib.parse import quote

import httpx

log = logging.getLogger("virtual_bot.tools.facts")

_WIKI_SUMMARY_URL = "https://{lang}.wikipedia.org/api/rest_v1/page/summary/{title}"
_WIKI_SEARCH_URL = "https://{lang}.wikipedia.org/w/api.php"

# Wikipedia вимагає User-Agent для REST API
_WIKI_HEADERS = {
    "Accept": "application/json",
    "User-Agent": "VirtualBot/1.0 (local diy bot; contact: bot@localhost)",
}

# Для початку шукаємо англійською; якщо не знайшли — українською.
_SEARCH_LANGS = ["en", "uk"]


def _normalize_query(query: str) -> str:
    return query.strip().replace(" ", "_")


async def _try_summary(title: str, lang: str = "en") -> dict | None:
    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            resp = await client.get(
                _WIKI_SUMMARY_URL.format(lang=lang, title=quote(title, safe="")),
                headers=_WIKI_HEADERS,
            )
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            data = resp.json()
    except Exception:
        return None

    extract = data.get("extract")
    if not extract:
        return None
    return {
        "title": data.get("title", title),
        "extract": extract,
        "summary": extract,
        "url": data.get("content_urls", {}).get("desktop", {}).get("page", ""),
        "lang": lang,
    }


async def _search_wikipedia(query: str, lang: str = "en") -> str | None:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                _WIKI_SEARCH_URL.format(lang=lang),
                params={
                    "action": "query",
                    "list": "search",
                    "srsearch": query,
                    "format": "json",
                    "srlimit": 1,
                },
                headers=_WIKI_HEADERS,
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception:
        return None

    results = data.get("query", {}).get("search", [])
    if not results:
        return None
    return results[0].get("title", "")


async def get_fact(query: str) -> dict:
    """Повертає короткий факт з Вікіпедії. Помилка — ключ 'error'."""
    query = query.strip()
    if not query:
        return {"error": "Вкажи, про що дізнатися"}

    for lang in _SEARCH_LANGS:
        # Спочатку спробуємо прямий запит
        result = await _try_summary(_normalize_query(query), lang=lang)
        if result:
            return result
        # Потім пошук
        found_title = await _search_wikipedia(query, lang=lang)
        if found_title:
            result = await _try_summary(_normalize_query(found_title), lang=lang)
            if result:
                return result

    return {"error": f"Не знайшов статті у Вікіпедії для «{query}»"}
