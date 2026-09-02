"""
«Клод Бот» — Virtual Bot: хто зараз живий (для окремої консолі).

Показує ПРОЦЕСИ й ШЛЮЗИ ланцюга — щоб під час розмови було видно не лише
«що бот відповів», а й через кого це пішло і хто з сусідів лежить.

Для кожного шлюзу:
- listening — порт слухає (TCP-конект; працює навіть якщо health-ручки нема);
- healthy   — health-ручка відповіла (і за скільки мілісекунд);
- pid/command — чий це процес (через `lsof`, один виклик на всі порти).

Чому і TCP, і health: у opencode (20131) health-ручки для нас нема, а знати,
що він піднявся, треба; а от «порт слухає, але /health віддає 500» — це саме
той стан, у якому OpenClaw «живий, але не працює», і його важливо розрізняти.

Нічого не запускає й не вбиває — це вікно спостереження, а не пульт
(старт/стоп сервісів живе в services_manager).
"""

from __future__ import annotations

import asyncio
import logging
import shutil
import subprocess
import time
from urllib.parse import urlparse

import httpx

import app_config as cfg

log = logging.getLogger("virtual_bot.processes")

# Скільки секунд тримаємо результат lsof (консоль опитує раз на ~3с, а lsof
# на кожен запит — зайва робота для системи)
_LSOF_TTL_S = 3.0
# Мітка часу — float("-inf"), а НЕ 0.0: time.monotonic() на старті процесу
# віддає долі секунди, тож нульова мітка виглядала б як «кеш щойно оновлено»
# і порожній словник повертався б вічно.
_lsof_cache: tuple[float, dict[int, dict]] = (float("-inf"), {})


def _port_of(url: str, default: int) -> int:
    """Порт із URL конфіга (щоб не дублювати числа, які вже там є)."""
    try:
        parsed = urlparse(url)
        if parsed.port:
            return int(parsed.port)
        if parsed.scheme == "https":
            return 443
        return default
    except Exception:  # noqa: BLE001
        return default


def _is_local(url: str) -> bool:
    """Локальний шлюз (порт можна перевірити) чи хмарний (лише health)."""
    try:
        host = (urlparse(url).hostname or "").lower()
        return host in ("127.0.0.1", "localhost", "::1", "0.0.0.0")
    except Exception:  # noqa: BLE001
        return False


def gateways() -> list[dict]:
    """
    Опис ланцюга. Порядок — той самий, у якому brains.chat пробує мозки,
    щоб у консолі зверху вниз читалось як маршрут запиту.
    """
    omni_root = cfg.OMNI_BASE_URL.rstrip("/")           # …:20128/v1
    chat2api_root = cfg.CHAT2API_BASE_URL.rstrip("/")   # …:8080/v1
    return [
        {
            "key": "self", "label": "Virtual Bot", "role": "панель, /screen, API",
            "url": f"http://127.0.0.1:{cfg.cfg('server', 'port', default=8100)}",
            "port": int(cfg.cfg("server", "port", default=8100)),
            "health": "/api/status", "local": True, "chain": "",
        },
        {
            "key": "openclaw", "label": "OpenClaw", "role": "мозок №1 — памʼять, тули, персона",
            "url": cfg.OPENCLAW_BASE_URL,
            "port": _port_of(cfg.OPENCLAW_BASE_URL, 18789),
            # Будь-яка відповідь = живий (так само вважає brains.check_openclaw_reachable)
            "health": "/", "any_status": True, "local": _is_local(cfg.OPENCLAW_BASE_URL),
            "chain": "1",
        },
        {
            "key": "omni", "label": "Omni-шим", "role": "мозок №2 — запасний роутер моделей",
            "url": omni_root, "port": _port_of(omni_root, 20128),
            "health": "/models", "local": _is_local(omni_root), "chain": "2",
        },
        {
            "key": "opencode", "label": "opencode serve", "role": "бекенд Omni-шима (його дитина)",
            "url": "http://127.0.0.1:20131", "port": 20131,
            "health": "", "local": True, "chain": "",
        },
        {
            "key": "anthropic", "label": "Anthropic-слот", "role": "мозок №3 — зовнішній шлюз Claude",
            "url": cfg.ANTHROPIC_BASE_URL, "port": _port_of(cfg.ANTHROPIC_BASE_URL, 443),
            # Хмарний шлюз не пінгуємо: без ключа у заголовку це або 401, або
            # марний трафік на кожне оновлення консолі. Стан видно по ходах.
            "health": "", "local": _is_local(cfg.ANTHROPIC_BASE_URL), "chain": "3",
        },
        {
            "key": "chat2api", "label": "Chat2API", "role": "мозок №4 — локальний OpenAI-сумісний",
            "url": chat2api_root, "port": _port_of(chat2api_root, 8080),
            "health": "/models", "local": _is_local(chat2api_root), "chain": "4",
        },
        {
            "key": "vision", "label": "Vision Agent", "role": "камера: обличчя й рух",
            "url": cfg.VISION_BASE_URL, "port": _port_of(cfg.VISION_BASE_URL, 8000),
            "health": "/health", "local": _is_local(cfg.VISION_BASE_URL), "chain": "",
        },
        {
            "key": "display", "label": "Display", "role": "обличчя бота (WS-міст)",
            "url": cfg.DISPLAY_BASE_URL, "port": _port_of(cfg.DISPLAY_BASE_URL, 8001),
            "health": "/health", "local": _is_local(cfg.DISPLAY_BASE_URL), "chain": "",
        },
    ]


def _lsof_map(ports: list[int]) -> dict[int, dict]:
    """
    {порт: {"pid":…, "command":…}} одним викликом lsof (з кешем).

    Без lsof (або якщо він мовчить) просто повертаємо порожньо — pid у консолі
    зникне, статус портів це не зачіпає.
    """
    global _lsof_cache
    now = time.monotonic()
    cached_at, cached = _lsof_cache
    if now - cached_at < _LSOF_TTL_S:
        return cached
    result: dict[int, dict] = {}
    binary = shutil.which("lsof")
    if binary and ports:
        spec = ",".join(str(p) for p in sorted(set(ports)))
        try:
            out = subprocess.run(
                [binary, "-nP", f"-iTCP:{spec}", "-sTCP:LISTEN"],
                capture_output=True, text=True, timeout=3.0,
            ).stdout
        except (OSError, subprocess.SubprocessError):
            out = ""
        for line in out.splitlines()[1:]:
            parts = line.split()
            if len(parts) < 9:
                continue
            name = parts[-2] if parts[-1] == "(LISTEN)" else parts[-1]
            try:
                port = int(name.rsplit(":", 1)[-1])
                pid = int(parts[1])
            except ValueError:
                continue
            result.setdefault(port, {"pid": pid, "command": parts[0]})
    _lsof_cache = (now, result)
    return result


async def _probe(client: httpx.AsyncClient, gw: dict) -> dict:
    """Один шлюз: чи слухає порт, чи відповідає health і за скільки мс."""
    row = {
        **{k: v for k, v in gw.items() if k not in ("any_status",)},
        "listening": None, "healthy": None, "latency_ms": None, "pid": None, "command": "",
    }
    if gw.get("local"):
        row["listening"] = await _tcp_open(gw["port"])
    if gw.get("health") and (row["listening"] is not False):
        url = gw["url"].rstrip("/") + gw["health"]
        started = time.perf_counter()
        try:
            resp = await client.get(url, timeout=1.5)
            row["healthy"] = True if gw.get("any_status") else (resp.status_code == 200)
            row["status_code"] = resp.status_code
        except Exception:  # noqa: BLE001 — недоступний шлюз це нормальний стан, не помилка
            row["healthy"] = False
        row["latency_ms"] = round((time.perf_counter() - started) * 1000, 1)
    return row


async def _tcp_open(port: int) -> bool:
    """Чи слухає локальний порт (швидкий конект без даних)."""
    try:
        fut = asyncio.open_connection("127.0.0.1", port)
        reader, writer = await asyncio.wait_for(fut, timeout=0.6)
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:  # noqa: BLE001 — сокет уже закритий, це не помилка
            pass
        return True
    except Exception:  # noqa: BLE001
        return False


async def snapshot() -> list[dict]:
    """Стан усіх шлюзів ланцюга (для GET /api/processes)."""
    gws = gateways()
    async with httpx.AsyncClient(trust_env=False) as client:
        rows = await asyncio.gather(*(_probe(client, gw) for gw in gws))
    ports = [gw["port"] for gw in gws if gw.get("local")]
    owners = await asyncio.to_thread(_lsof_map, ports)
    for row in rows:
        info = owners.get(row.get("port")) if row.get("local") else None
        if info:
            row["pid"] = info["pid"]
            row["command"] = info["command"]
    return list(rows)
