"""
Тулза «Веб-пошук»: DuckDuckGo Lite (без ключа).
"""

from __future__ import annotations

import logging
import re
from urllib.parse import quote_plus

import httpx

log = logging.getLogger("virtual_bot.tools.search")

_DDG_URL = "https://lite.duckduckgo.com/lite/"
_DDG_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html",
    "Accept-Language": "uk-UA,uk;q=0.9,en-US;q=0.8,en;q=0.7",
}


def _clean_text(text: str) -> str:
    """Прибирає зайві пробіли, HTML-коди та обриває до 200 символів."""
    text = re.sub(r"\s+", " ", text)
    text = text.replace("&nbsp;", " ").replace("&#39;", "'").replace("&quot;", '"').replace("&amp;", "&")
    return text.strip()


async def search_web(query: str, count: int = 3) -> dict:
    """Шукає в DuckDuckGo Lite. Повертає результати або error."""
    query = (query or "").strip()
    if not query:
        return {"error": "Вкажи запит для пошуку"}

    count = max(1, min(int(count or 3), 5))

    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            resp = await client.post(
                _DDG_URL,
                headers=_DDG_HEADERS,
                data={"q": query, "kl": "uk-ua"},
            )
            resp.raise_for_status()
            html = resp.text
    except Exception as exc:
        log.warning("DuckDuckGo error: %s", type(exc).__name__)
        return {"error": "Не вдалося виконати пошук"}

    # Парсимо результати: заголовок, посилання, сніппет
    results: list[dict] = []
    # Кожен результат у таблиці з класом result-link (DDG Lite використовує одинарні лапки)
    for m in re.finditer(
        r"<a[^>]*href=['\"]([^'\"]+)['\"][^>]*class=['\"][^'\"]*result-link[^'\"]*['\"][^>]*>(.*?)</a>",
        html,
        re.IGNORECASE | re.DOTALL,
    ):
        url = m.group(1)
        title = _clean_text(re.sub(r"<[^>]+>", "", m.group(2)))
        if title and url:
            results.append({"title": title, "url": url})

    # Шукаємо сніппети поруч
    snippets = re.findall(
        r"<td[^>]*class=['\"]result-snippet[^'\"]*['\"][^>]*>(.*?)</td>",
        html,
        re.IGNORECASE | re.DOTALL,
    )
    for i, snippet_html in enumerate(snippets):
        if i >= len(results):
            break
        snippet = _clean_text(re.sub(r"<[^>]+>", "", snippet_html))
        results[i]["snippet"] = snippet[:200] + "…" if len(snippet) > 200 else snippet

    results = results[:count]
    if not results:
        return {"error": "Нічого не знайшов за цим запитом"}

    return {
        "query": query,
        "results": results,
    }
