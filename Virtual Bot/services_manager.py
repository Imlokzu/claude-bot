"""
«Клод Бот» — Virtual Bot: менеджер локальних сервісів (Vision, Display).

Запускає/зупиняє сусідні модулі проєкту як дочірні процеси:
- Vision Agent  → uvicorn main:app на 127.0.0.1:8000 (health: GET /health)
- Display       → python -m backend.server --port 8001 (health: GET /health)

Правила безпеки:
- використовуємо .venv/bin/python модуля, якщо є, інакше системний python3;
- подвійний start не плодить процеси (перевірка health + власного процесу);
- stop вбиває ЛИШЕ процес, який запустили ми (чужий процес не чіпаємо).
"""

from __future__ import annotations

import logging
import os
import signal
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path

import httpx

import app_config as cfg

log = logging.getLogger("virtual_bot.services")


@dataclass
class ServiceSpec:
    """Опис одного керованого сервісу."""
    name: str
    directory: Path
    args: list[str]  # аргументи ПІСЛЯ python-інтерпретатора
    health_url: str


SERVICES: dict[str, ServiceSpec] = {
    "vision": ServiceSpec(
        name="vision",
        directory=cfg.VISION_DIR,
        args=["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8000"],
        health_url=f"{cfg.VISION_BASE_URL}/health",
    ),
    "display": ServiceSpec(
        name="display",
        directory=cfg.DISPLAY_DIR,
        # Display стартує так, як описано в його README:
        # python -m backend.server --port 8001
        args=["-m", "backend.server", "--host", "127.0.0.1", "--port", "8001"],
        health_url=f"{cfg.DISPLAY_BASE_URL}/health",
    ),
}

# Наші запущені процеси: name -> Popen
_procs: dict[str, subprocess.Popen] = {}
_lock = threading.Lock()


def _python_for(spec: ServiceSpec) -> str:
    """Python модуля: його .venv/bin/python, якщо існує, інакше системний."""
    venv_python = spec.directory / ".venv" / "bin" / "python"
    if venv_python.is_file():
        return str(venv_python)
    return sys.executable or "python3"


def _health_ok(spec: ServiceSpec, timeout: float = 1.5) -> bool:
    """Чи відповідає сервіс на свій health-ендпоінт (локально, без проксі)."""
    try:
        resp = httpx.get(
            spec.health_url, timeout=timeout,
            trust_env=cfg.httpx_trust_env(spec.health_url),
        )
        return resp.status_code == 200
    except Exception:  # noqa: BLE001 — статус сервісу не має права валити ендпоінт
        return False


def _our_proc_alive(name: str) -> subprocess.Popen | None:
    """Наш живий процес сервісу або None (мертві прибираємо зі словника)."""
    proc = _procs.get(name)
    if proc is None:
        return None
    if proc.poll() is None:
        return proc
    _procs.pop(name, None)
    return None


def get_status(name: str) -> dict:
    """Статус сервісу: online (health), managed (запущений нами), pid."""
    spec = SERVICES[name]
    with _lock:
        proc = _our_proc_alive(name)
    return {
        "service": name,
        "online": _health_ok(spec),
        "managed": proc is not None,
        "pid": proc.pid if proc else None,
    }


def get_all_statuses() -> dict:
    """Статуси всіх сервісів для GET /api/services."""
    return {name: get_status(name) for name in SERVICES}


def start_service(name: str) -> dict:
    """
    Запускає сервіс, якщо він ще не працює.
    Подвійний start безпечний: якщо health вже ОК або наш процес живий —
    нового процесу не створюємо.
    """
    spec = SERVICES[name]

    with _lock:
        if _our_proc_alive(name) is not None:
            status = get_status_unlocked(spec, name)
            status["message"] = "Сервіс уже запущено цією панеллю"
            return status
        if _health_ok(spec):
            return {
                "service": name, "online": True, "managed": False, "pid": None,
                "message": "Сервіс уже працює (запущений не нами) — новий процес не створюю",
            }

        if not spec.directory.is_dir():
            return {
                "service": name, "online": False, "managed": False, "pid": None,
                "error": f"Папку модуля не знайдено: {spec.directory}",
            }

        python = _python_for(spec)
        cfg.SERVICE_LOGS_DIR.mkdir(parents=True, exist_ok=True)
        log_path = cfg.SERVICE_LOGS_DIR / f"{name}.log"
        log_file = open(log_path, "ab")  # noqa: SIM115 — файл живе разом із процесом
        try:
            proc = subprocess.Popen(
                [python, *spec.args],
                cwd=str(spec.directory),
                stdout=log_file,
                stderr=subprocess.STDOUT,
                start_new_session=True,  # окрема група процесів — щоб зупиняти адресно
            )
        except OSError as exc:
            log_file.close()
            return {
                "service": name, "online": False, "managed": False, "pid": None,
                "error": f"Не вдалося запустити: {exc}",
            }
        finally:
            # Наш дескриптор більше не потрібен — процес тримає свій
            if not log_file.closed:
                log_file.close()
        _procs[name] = proc

    # Чекаємо появи health (до ~12 секунд) вже без лока
    deadline = time.monotonic() + 12.0
    online = False
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            break  # процес помер на старті
        if _health_ok(spec, timeout=0.8):
            online = True
            break
        time.sleep(0.4)

    if proc.poll() is not None:
        with _lock:
            _procs.pop(name, None)
        return {
            "service": name, "online": False, "managed": False, "pid": None,
            "error": f"Процес завершився одразу після старту (див. service_logs/{name}.log)",
        }

    return {
        "service": name, "online": online, "managed": True, "pid": proc.pid,
        "message": "Запущено" if online else "Процес стартував, але health ще не відповідає",
    }


def get_status_unlocked(spec: ServiceSpec, name: str) -> dict:
    """Статус без повторного взяття лока (для викликів зсередини)."""
    proc = _procs.get(name)
    alive = proc is not None and proc.poll() is None
    return {
        "service": name,
        "online": _health_ok(spec),
        "managed": alive,
        "pid": proc.pid if alive and proc else None,
    }


def stop_service(name: str) -> dict:
    """
    Зупиняє ЛИШЕ наш процес сервісу (SIGTERM групі, потім SIGKILL).
    Якщо сервіс працює, але запущений не нами — не чіпаємо і кажемо про це.
    """
    spec = SERVICES[name]
    with _lock:
        proc = _our_proc_alive(name)
        if proc is None:
            if _health_ok(spec):
                return {
                    "service": name, "online": True, "managed": False, "pid": None,
                    "error": "Сервіс працює, але запущений не цією панеллю — зупиніть його вручну",
                }
            return {
                "service": name, "online": False, "managed": False, "pid": None,
                "message": "Сервіс і так не запущений",
            }
        _procs.pop(name, None)

    # М'яко: SIGTERM усій групі процесу (він у власній сесії)
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        pass
    try:
        proc.wait(timeout=6)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            log.error("Не вдалося дочекатися завершення процесу %s (pid=%s)", name, proc.pid)

    return {
        "service": name, "online": _health_ok(spec), "managed": False, "pid": None,
        "message": "Зупинено",
    }


def shutdown_all() -> None:
    """Зупиняє всі наші процеси при виході бекенду (щоб не лишати сиріт)."""
    for name in list(_procs):
        try:
            stop_service(name)
        except Exception:  # noqa: BLE001 — на шатдауні головне не впасти
            log.exception("Помилка зупинки сервісу %s на виході", name)
