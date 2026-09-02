"""
«Клод Бот» — бекенд вбудованого браузера.

Сторінки тягне сервер і віддає їх панелі: інакше більшість сайтів взагалі не
відкрилися б у <iframe> (X-Frame-Options / CSP frame-ancestors). Разом із тим
такий проксі — це запит із машини користувача за довільною адресою, тож:

- дозволені лише http/https;
- кожен хост резолвиться, і приватні/локальні адреси (127.0.0.0/8, 10/8,
  192.168/16, link-local, ::1 …) відсікаються — щоб через панель не можна
  було достукатись до внутрішніх сервісів;
- редіректи проходимо вручну, перевіряючи КОЖЕН крок (follow_redirects=True
  обійшов би перевірку на другому хопі);
- обсяг відповіді обмежений, щоб вкладка не з'їла памʼять.
"""

from __future__ import annotations

import ipaddress
import logging
import socket
from html import escape
from urllib.parse import urljoin, urlparse

import httpx

log = logging.getLogger("virtual_bot.browser")

MAX_BYTES = 5_000_000
MAX_REDIRECTS = 5
TIMEOUT_S = 20.0

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36 ClaudeBot-Panel"
)

# Скрипт-місток: клік по посиланню не «провалює» вкладку кудись сам по собі,
# а віддає адресу батьківській сторінці — вона й веде навігацію через проксі.
_BRIDGE = """
<script>
(function () {
  function send(url) {
    try { parent.postMessage({ type: 'claudebot-navigate', url: url }, '*'); } catch (e) {}
  }
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var href = a.getAttribute('href') || '';
    if (href.startsWith('javascript:') || href.startsWith('#')) return;
    e.preventDefault();
    send(a.href);
  }, true);
  document.addEventListener('submit', function (e) { e.preventDefault(); }, true);
})();
</script>
"""


class BrowserError(Exception):
    """Помилка, яку показуємо користувачеві як є (без трейсбека)."""


def looks_like_url(raw: str) -> bool:
    """Адреса це чи пошуковий запит («хто такий краб» — точно не адреса)."""
    text = (raw or "").strip()
    if not text or " " in text:
        return False
    return "://" in text or "." in text.split("/")[0]


def normalize_url(raw: str) -> str:
    """'example.com' → 'https://example.com'."""
    text = (raw or "").strip()
    if not text:
        raise BrowserError("Порожня адреса")
    if "://" not in text:
        text = "https://" + text
    return text


async def search_page(query: str) -> str:
    """
    Сторінка результатів пошуку, яку малюємо САМІ.

    Проксі-запит до пошуковика повертає капчу («bots use DuckDuckGo too»), тож
    беремо ті самі результати через уже наявний тулз web_search — той, яким
    користується й сам бот, — і показуємо їх звичайним списком посилань.
    """
    from tools.search import search_web

    data = await search_web(query, count=5)
    q = escape(query)
    if data.get("error"):
        body = f"<p class='err'>{escape(str(data['error']))}</p>"
    else:
        items = []
        for r in data.get("results", []):
            url = escape(str(r.get("url") or ""), quote=True)
            items.append(
                f"<li><a href=\"{url}\">{escape(str(r.get('title') or url))}</a>"
                f"<div class='u'>{escape(str(r.get('url') or ''))}</div>"
                f"<p>{escape(str(r.get('snippet') or ''))}</p></li>"
            )
        body = "<ul>" + "".join(items) + "</ul>" if items else "<p class='err'>Нічого не знайшлось</p>"

    return f"""<!doctype html><meta charset="utf-8">
<style>
  body {{ font: 14px -apple-system, system-ui, sans-serif; color: #2B2A26; background: #FBFAF7;
         margin: 0; padding: 22px 26px; }}
  h1 {{ font-size: 15px; color: #83817A; font-weight: 600; margin: 0 0 16px; }}
  ul {{ list-style: none; margin: 0; padding: 0; }}
  li {{ margin-bottom: 18px; }}
  a {{ color: #C96442; font-size: 15px; text-decoration: none; }}
  a:hover {{ text-decoration: underline; }}
  .u {{ font-size: 11px; color: #83817A; margin: 2px 0 4px; word-break: break-all; }}
  p {{ margin: 0; line-height: 1.5; }}
  .err {{ color: #B4443A; }}
</style>
<h1>Пошук: {q}</h1>
{body}
{_BRIDGE}"""


def _check_public(url: str) -> None:
    """Схема + жодних приватних/локальних адрес."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise BrowserError("Дозволені лише http(s) адреси")
    host = parsed.hostname
    if not host:
        raise BrowserError("Некоректна адреса")
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        raise BrowserError(f"Не вдалося знайти хост: {host}")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            raise BrowserError("Локальні та внутрішні адреси через браузер недоступні")


async def _fetch(url: str) -> httpx.Response:
    """GET із ручним проходом редіректів і перевіркою кожного хопа."""
    current = url
    async with httpx.AsyncClient(
        timeout=TIMEOUT_S,
        follow_redirects=False,
        headers={"User-Agent": USER_AGENT, "Accept-Language": "uk,en;q=0.8"},
    ) as client:
        for _ in range(MAX_REDIRECTS + 1):
            _check_public(current)
            resp = await client.send(client.build_request("GET", current), stream=True)
            if resp.is_redirect:
                await resp.aclose()
                location = resp.headers.get("location", "")
                if not location:
                    return resp
                current = urljoin(current, location)
                continue
            # Тіло читаємо ПОТОКОМ і зупиняємось на ліміті: resp.content
            # затягнув би весь ресурс у памʼять, і обмеження було б фікцією.
            chunks: list[bytes] = []
            size = 0
            async for chunk in resp.aiter_bytes():
                chunks.append(chunk)
                size += len(chunk)
                if size >= MAX_BYTES:
                    break
            await resp.aclose()
            resp._claudebot_url = current  # type: ignore[attr-defined]
            resp._claudebot_body = b"".join(chunks)[:MAX_BYTES]  # type: ignore[attr-defined]
            return resp
    raise BrowserError("Забагато переадресацій")


def _inject(html: str, base_url: str) -> str:
    """
    Ставимо <base>, щоб відносні картинки/стилі тягнулись із самого сайту,
    і місток кліків. Вставляємо одразу після <head>, інакше відносні шляхи
    вище за наш тег уже встигли б розвʼязатись відносно 8100.
    """
    base_tag = f'<base href="{escape(base_url, quote=True)}">'
    lowered = html.lower()
    idx = lowered.find("<head")
    if idx != -1:
        end = lowered.find(">", idx)
        if end != -1:
            return html[: end + 1] + base_tag + _BRIDGE + html[end + 1 :]
    return base_tag + _BRIDGE + html


async def load(url: str) -> dict:
    """
    Завантажує сторінку. Повертає:
    {"kind": "html", "url", "title", "html"} або
    {"kind": "binary", "url", "content_type", "content"} для не-HTML.
    """
    target = normalize_url(url)
    try:
        resp = await _fetch(target)
    except BrowserError:
        raise
    except httpx.HTTPError as exc:
        raise BrowserError(f"Не вдалося відкрити сторінку ({type(exc).__name__})")

    final_url = getattr(resp, "_claudebot_url", target)
    content_type = (resp.headers.get("content-type") or "").split(";")[0].strip().lower()
    body = getattr(resp, "_claudebot_body", b"")

    if content_type.startswith("text/html") or (not content_type and b"<html" in body[:2048].lower()):
        text = body.decode(resp.encoding or "utf-8", errors="replace")
        title = ""
        lowered = text.lower()
        start = lowered.find("<title")
        if start != -1:
            open_end = lowered.find(">", start)
            close = lowered.find("</title", open_end)
            if open_end != -1 and close != -1:
                title = text[open_end + 1 : close].strip()[:200]
        return {
            "kind": "html",
            "url": final_url,
            "status": resp.status_code,
            "title": title,
            "html": _inject(text, final_url),
        }

    return {
        "kind": "binary",
        "url": final_url,
        "status": resp.status_code,
        "content_type": content_type or "application/octet-stream",
        "content": body,
    }
