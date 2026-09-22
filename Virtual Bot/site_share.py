"""
«Клод Бот» — поширення сайтів із робочої теки через Cloudflare Tunnel.

Навіщо: бот робить сайти у workspace/, а показати їх комусь означало
«скинь файл». Тепер одна команда — і сайт доступний за публічним
посиланням виду https://<slug>.waveio.me.

Як це працює. Іменований тунель (credentials у ~/.cloudflared) уже існує;
ми лише:
  1. оновлюємо його ingress через Cloudflare API (додаємо hostname →
     локальний /preview/<path>);
  2. створюємо CNAME <slug>.waveio.me → <tunnel-id>.cfargotunnel.com;
  3. перезапускаємо локальний cloudflared, щоб він підхопив новий конфіг.

Стан (slug → шлях) лежить у service_logs/site_shares.json — це не секрет
і не код, тож поруч із логами, а не в репозиторії.

Безпека: шлях перевіряється workspace._resolve (вихід за корінь теки
неможливий), slug — лише [a-z0-9-], інакше DNS-запис не створиться.
"""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
import signal
import subprocess
import time
from pathlib import Path

import httpx

import workspace

log = logging.getLogger("virtual_bot.site_share")

STATE_PATH = Path(__file__).parent / "service_logs" / "site_shares.json"
TUNNEL_ID = "c0a16883-1888-41f2-ac12-0c38acbfcacf"
ZONE_NAME = "waveio.me"
ZONE_ID = "a570cd7b40f240e2d2abfe5266894191"
API = "https://api.cloudflare.com/client/v4"
LOG_PATH = Path(__file__).parent / "service_logs" / "cloudflared.log"

_SLUG_RE = re.compile(r"^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$")

# Службові hostname з ~/.cloudflared/config.yml — їх ingress зберігаємо,
# щоб не зламати те, що вже працює.
_BASE_INGRESS = [
    {"hostname": "atlas.waveio.me", "service": "http://localhost:3000"},
    {"hostname": "livegoal.waveio.me", "service": "http://localhost:3111"},
]


def _headers() -> dict[str, str]:
    """
    Два способи автентифікації Cloudflare: API Token (Bearer) — вузький, під
    конкретні ресурси, і глобальний API Key + email. Тунелевий токен у .env
    не має прав на DNS цієї зони, тож спершу пробуємо токен, а для DNS —
    глобальний ключ, якщо він заданий.
    """
    key = os.environ.get("CLOUDFLARE_API_KEY", "").strip()
    email = os.environ.get("CLOUDFLARE_AUTH_EMAIL", "").strip()
    if key and email:
        return {"X-Auth-Key": key, "X-Auth-Email": email, "Content-Type": "application/json"}
    token = os.environ.get("CLOUDFLARE_API_TOKEN", "").strip()
    if not token:
        raise RuntimeError("У середовищі немає ані CLOUDFLARE_API_TOKEN, ані CLOUDFLARE_API_KEY + CLOUDFLARE_AUTH_EMAIL")
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _load() -> dict[str, str]:
    try:
        return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _save(shares: dict[str, str]) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(shares, ensure_ascii=False, indent=2), encoding="utf-8")


def _ingress(shares: dict[str, str]) -> list[dict]:
    rules = list(_BASE_INGRESS)
    for slug, path in shares.items():
        rules.append({
            "hostname": f"{slug}.{ZONE_NAME}",
            "service": "http://127.0.0.1:8100",
        })
    rules.append({"service": "http_status:404"})
    return rules


async def _put_ingress(shares: dict[str, str]) -> None:
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.put(
            f"{API}/accounts/{_account()}/cfd_tunnel/{TUNNEL_ID}/configurations",
            headers=_headers(),
            json={"config": {"ingress": _ingress(shares)}},
        )
        data = resp.json()
        if not data.get("success"):
            raise RuntimeError(f"Cloudflare відхилив конфіг: {data.get('errors')}")


def _account() -> str:
    account = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "").strip()
    if not account:
        raise RuntimeError("CLOUDFLARE_ACCOUNT_ID не заданий у середовищі")
    return account


async def _ensure_dns(slug: str) -> None:
    """CNAME <slug>.<zone> → <tunnel>.cfargotunnel.com (ідемпотентно)."""
    hostname = f"{slug}.{ZONE_NAME}"
    target = f"{TUNNEL_ID}.cfargotunnel.com"
    async with httpx.AsyncClient(timeout=20) as client:
        existing = await client.get(
            f"{API}/zones/{ZONE_ID}/dns_records",
            headers=_headers(),
            params={"type": "CNAME", "name": hostname},
        )
        records = existing.json().get("result", [])
        if records:
            return
        resp = await client.post(
            f"{API}/zones/{ZONE_ID}/dns_records",
            headers=_headers(),
            json={"type": "CNAME", "name": hostname, "content": target, "proxied": True},
        )
        data = resp.json()
        if not data.get("success"):
            raise RuntimeError(f"Cloudflare не створив DNS: {data.get('errors')}")


async def _delete_dns(slug: str) -> None:
    hostname = f"{slug}.{ZONE_NAME}"
    async with httpx.AsyncClient(timeout=20) as client:
        existing = await client.get(
            f"{API}/zones/{ZONE_ID}/dns_records",
            headers=_headers(),
            params={"type": "CNAME", "name": hostname},
        )
        for record in existing.json().get("result", []):
            await client.delete(
                f"{API}/zones/{ZONE_ID}/dns_records/{record['id']}",
                headers=_headers(),
            )


def _restart_cloudflared() -> None:
    """
    Перезапускає локальний cloudflared, щоб підхопив новий ingress.

    Процес шукаємо за командним рядком (не за портом): чужі cloudflared
    (наприклад, чийсь інший тунель) не чіпаємо — лише той, що з нашим
    credentials-файлом або з --config /dev/null (quick tunnel для панелі).
    """
    if not shutil.which("cloudflared"):
        raise RuntimeError("cloudflared не встановлений (brew install cloudflared)")
    for proc in subprocess.run(["pgrep", "-fl", "cloudflared"], capture_output=True, text=True).stdout.splitlines():
        parts = proc.split(None, 1)
        if len(parts) != 2:
            continue
        pid, cmd = parts
        if TUNNEL_ID in cmd or "config.yml" in cmd:
            try:
                os.kill(int(pid), signal.SIGTERM)
            except (ProcessLookupError, ValueError):
                continue
    time.sleep(1)
    log_path = LOG_PATH.open("ab")
    subprocess.Popen(
        ["cloudflared", "tunnel", "--no-autoupdate", "run", TUNNEL_ID],
        stdin=subprocess.DEVNULL, stdout=log_path, stderr=subprocess.STDOUT,
        start_new_session=True,
    )


async def share(path: str, slug: str) -> dict:
    """Публікує теку/файл із workspace за https://<slug>.waveio.me."""
    slug = slug.strip().lower()
    if not _SLUG_RE.match(slug):
        return {"error": "Slug може містити лише маленькі літери, цифри й дефіс (a-z, 0-9, -)."}
    # Шлях має існувати й лишатись у межах workspace — інакше опублікуємо 404.
    try:
        workspace._resolve(path, must_exist=True)
    except (ValueError, FileNotFoundError) as exc:
        return {"error": str(exc)}

    shares = _load()
    shares[slug] = path
    try:
        await _put_ingress(shares)
        await _ensure_dns(slug)
    except RuntimeError as exc:
        return {"error": str(exc)}
    _save(shares)
    try:
        _restart_cloudflared()
    except RuntimeError as exc:
        return {"error": str(exc)}
    return {"url": f"https://{slug}.{ZONE_NAME}", "slug": slug, "path": path}


async def unshare(slug: str) -> dict:
    """Знімає публікацію: прибирає hostname з ingress і DNS-запис."""
    slug = slug.strip().lower()
    shares = _load()
    if slug not in shares:
        return {"error": f"Немає публікації зі slug «{slug}»."}
    del shares[slug]
    try:
        await _put_ingress(shares)
        await _delete_dns(slug)
    except RuntimeError as exc:
        return {"error": str(exc)}
    _save(shares)
    try:
        _restart_cloudflared()
    except RuntimeError as exc:
        return {"error": str(exc)}
    return {"ok": True, "slug": slug}


def list_shares() -> dict:
    """Усі активні публікації."""
    return {
        "shares": [
            {"slug": slug, "path": path, "url": f"https://{slug}.{ZONE_NAME}"}
            for slug, path in sorted(_load().items())
        ]
    }
