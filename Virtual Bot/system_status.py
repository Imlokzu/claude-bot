"""
Стан фізичного пристрою для екрана налаштувань.

Зараз бот працює у віртуальному режимі, тому API віддає стабільний snapshot
із чесною ознакою `mode: virtual`. Пізніше native-адаптер можна підключити
без зміни контракту: роутер уже відокремлений від `main.py`.
"""

from __future__ import annotations

import asyncio
import logging
import platform
import re
import shutil
import subprocess
from datetime import datetime, timezone
from typing import Any, Callable

from fastapi import APIRouter

import app_config as cfg


log = logging.getLogger("virtual_bot.system_status")
router = APIRouter(prefix="/api/system", tags=["system"])

_COMMAND_TIMEOUT_S = 2.0
_SAFE_NAME_RE = re.compile(r"[^\w .()+'-]+", re.UNICODE)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _clean_text(value: Any, default: str = "") -> str:
    if value is None:
        return default
    text = str(value).strip()
    return text or default


def _safe_name(value: Any, default: str) -> str:
    text = _SAFE_NAME_RE.sub("", _clean_text(value, default)).strip()
    return text or default


def _clamp(value: Any, default: int = 0) -> int:
    try:
        return max(0, min(100, int(value)))
    except (TypeError, ValueError):
        return default


def _virtual_device(name: str, icon: str, kind: str, connected: bool = True) -> dict[str, Any]:
    return {
        "id": f"virtual-{kind}",
        "name": name,
        "kind": kind,
        "icon": icon,
        "connected": connected,
        "virtual": True,
    }


def _virtual_status() -> dict[str, Any]:
    """Повертає deterministic fallback для macOS-розробки без Raspberry Pi."""
    device_name = _safe_name(cfg.cfg("system", "device_name", default="Клод Бот"), "Клод Бот")
    battery_level = _clamp(cfg.cfg("system", "battery_level", default=82), 82)
    wifi_name = _safe_name(cfg.cfg("system", "wifi", "ssid", default="Claude-Bot"), "Claude-Bot")
    output_name = _safe_name(
        cfg.cfg("system", "audio", "output_name", default="Вбудований динамік"),
        "Вбудований динамік",
    )
    input_name = _safe_name(
        cfg.cfg("system", "audio", "input_name", default="Вбудований мікрофон"),
        "Вбудований мікрофон",
    )
    headphones_connected = cfg.cfg_bool("system", "audio", "headphones_connected", default=False)
    output_device = (
        _virtual_device("AirPods Pro", "headphones", "output")
        if headphones_connected
        else _virtual_device(output_name, "speaker", "output")
    )
    input_device = _virtual_device(input_name, "mic", "input")
    headphones_device = {
        "id": "virtual-headphones",
        "name": "AirPods Pro",
        "kind": "output",
        "icon": "headphones",
        "connected": headphones_connected,
        "virtual": True,
        "battery": 76 if headphones_connected else None,
    }
    bluetooth_headphones = {
        **headphones_device,
        "kind": "headphones",
        "last_seen": "щойно" if headphones_connected else "сьогодні о 09:42",
    }
    return {
        "mode": "virtual",
        "updated_at": _now(),
        "device": {
            "name": device_name,
            "kind": "virtual-bot",
            "icon": "bot",
            "battery": {
                "level": battery_level,
                "charging": cfg.cfg_bool("system", "battery_charging", default=True),
                "health": 100,
            },
        },
        "wifi": {
            "enabled": True,
            "status": "connected",
            "ssid": wifi_name,
            "signal": _clamp(cfg.cfg("system", "wifi", "signal", default=86), 86),
            "ip": _clean_text(cfg.cfg("system", "wifi", "ip", default="192.168.1.42"), "192.168.1.42"),
            "secured": True,
            "networks": [
                {"ssid": wifi_name, "signal": 86, "secured": True, "known": True},
                {"ssid": "Studio-5G", "signal": 64, "secured": True, "known": False},
                {"ssid": "Guest network", "signal": 41, "secured": False, "known": False},
            ],
        },
        "bluetooth": {
            "enabled": True,
            "status": "connected" if headphones_connected else "ready",
            "discoverable": False,
            "devices": [
                {
                    **bluetooth_headphones,
                },
                {
                    **_virtual_device("Клавіатура", "keyboard", "keyboard", False),
                    "battery": 58,
                    "last_seen": "вчора",
                },
            ],
        },
        "audio": {
            "output": output_device,
            "input": input_device,
            "devices": [
                output_device,
                input_device,
                headphones_device,
            ],
            "routes": [
                {"id": "bot", "label": "Голос бота", "icon": "bot", "volume": 72, "muted": False},
                {"id": "youtube", "label": "YouTube", "icon": "youtube", "volume": 58, "muted": False},
                {"id": "alarm", "label": "Будильник", "icon": "alarm", "volume": 84, "muted": False},
                {"id": "notifications", "label": "Сповіщення", "icon": "bell", "volume": 44, "muted": False},
            ],
        },
        "capabilities": {
            "bluetooth_pairing": False,
            "wifi_configuration": False,
            "audio_routing": True,
            "native_controls": False,
        },
    }


def _run_command(command: list[str]) -> str:
    """Безпечний короткий виклик для майбутнього native-адаптера."""
    if not command or shutil.which(command[0]) is None:
        return ""
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=_COMMAND_TIMEOUT_S,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    return result.stdout.strip()


def _native_status() -> dict[str, Any]:
    """Мінімальний native-адаптер: поки що делегує до virtual-контракту.

    Функція навмисно існує окремо від роутера, щоб Raspberry Pi-реалізація могла
    замінити тільки цей шар і залишити UI без змін.
    """
    status = _virtual_status()
    status["mode"] = "native"
    status["capabilities"] = {
        **status["capabilities"],
        "native_controls": True,
    }
    system = platform.system().casefold()
    if system == "darwin":
        _run_command(["system_profiler", "SPAudioDataType", "-json"])
    elif system == "linux":
        _run_command(["pactl", "-f", "json", "list", "short", "sinks"])
    return status


def _native_enabled() -> bool:
    return cfg.cfg_bool("system", "native", default=False)


def _build_status() -> dict[str, Any]:
    return _native_status() if _native_enabled() else _virtual_status()


@router.get("/status")
async def system_status() -> dict[str, Any]:
    """Стан підключень, живлення та аудіо без блокування event loop."""
    collector: Callable[[], dict[str, Any]] = _build_status
    try:
        return await asyncio.to_thread(collector)
    except Exception:  # noqa: BLE001 — статус не має ламати основний API
        log.exception("Не вдалося зібрати стан системи")
        return _virtual_status()


@router.get("/audio/devices")
async def audio_devices() -> dict[str, Any]:
    """Скорочений список входів/виходів для селектора аудіо."""
    status = await system_status()
    return {
        "mode": status["mode"],
        "updated_at": status["updated_at"],
        "input": status["audio"]["input"],
        "output": status["audio"]["output"],
        "devices": status["audio"]["devices"],
    }


@router.get("/network")
async def network_status() -> dict[str, Any]:
    """Скорочений snapshot Wi‑Fi та Bluetooth для шторки підключень."""
    status = await system_status()
    return {
        "mode": status["mode"],
        "updated_at": status["updated_at"],
        "wifi": status["wifi"],
        "bluetooth": status["bluetooth"],
    }
