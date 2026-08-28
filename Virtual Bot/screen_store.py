"""
«Клод Бот» — магазин екрана (device store).

Пакети, які можна встановити ПРЯМО з екрана пристрою (/screen → Застосунки →
Магазин). Два типи:
- app  — застосунок екрана: тека з `package.json` і `index.html`. Після
         встановлення з'являється у шухляді застосунків і відкривається
         в iframe з `/store-apps/<id>/index.html` (тека installed/apps).
- skin — скін: набір CSS-змінних теми (--bg, --accent, ...), який екран
         застосовує до всього інтерфейсу миттєво.

Скіли та MCP-тулзи живуть в ОКРЕМОМУ контурі (OpenClaw: `openclaw skills
install`, кураторський MCP-каталог) — екранний магазин показує і їх, але
через наявні /api/store ендпоінти, не через цей модуль.

Файлова модель (одне джерело правди — файлова система):
  store/packages/<id>/package.json   — вихідники пакетів (у репозиторії)
  store/installed/apps/<id>/…        — встановлені застосунки (runtime)
  store/installed/skins/<id>.json    — встановлені скіни (runtime)

Жодних реєстрів у коді: встановлений пакет = пакет, чия тека/файл існує
в installed/. Видалення = видалення теки.
"""

from __future__ import annotations

import json
import logging
import re
import shutil
from pathlib import Path
from threading import Lock
from typing import Any

import app_config

log = logging.getLogger("virtual_bot.screen_store")

# id пакета: дрібні літери/цифри/дефіси — цього достатньо і для теки, і для URL
PKG_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,31}$")

# Очікувані поля маніфесту; невідомі типи молчазно пропускаємо, щоб випадковий
# файл у packages/ не зламав увесь каталог
PKG_TYPES = ("app", "skin")

MAX_MANIFEST_BYTES = 16_000
MAX_PACKAGE_FILES = 200

_store_lock = Lock()


class StoreError(Exception):
    """Керована помилка магазину: повідомлення віддаємо клієнту як detail."""

    def __init__(self, message: str, *, code: str = "store_error") -> None:
        super().__init__(message)
        self.code = code


def _store_dir() -> Path:
    return Path(app_config.STORE_DIR)


def packages_dir() -> Path:
    return _store_dir() / "packages"


def installed_dir(kind: str) -> Path:
    return _store_dir() / "installed" / kind


def validate_pkg_id(pkg_id: str) -> str:
    """Перевіряє id: без цього /../ і службові імена проїхали б у шлях."""
    pkg_id = (pkg_id or "").strip()
    if not PKG_ID_RE.match(pkg_id):
        raise StoreError("Некоректний id пакета", code="invalid_id")
    return pkg_id


def load_manifest(pkg_id: str) -> dict[str, Any] | None:
    """Читає packages/<id>/package.json; None — пакета немає або він зіпсований."""
    path = packages_dir() / validate_pkg_id(pkg_id) / "package.json"
    try:
        raw = path.read_bytes()
    except OSError:
        return None
    if len(raw) > MAX_MANIFEST_BYTES:
        return None
    try:
        manifest = json.loads(raw)
    except ValueError:
        return None
    if not isinstance(manifest, dict) or manifest.get("type") not in PKG_TYPES:
        return None
    if manifest.get("id") != pkg_id:
        # id у файлі — захист від копіювання теки з чужим id всередині
        return None
    return manifest


def _manifests() -> list[dict[str, Any]]:
    """Усі валідні маніфести з packages/, відсортовані за назвою."""
    out: list[dict[str, Any]] = []
    try:
        entries = sorted(packages_dir().iterdir())
    except OSError:
        return out
    for entry in entries:
        if not entry.is_dir():
            continue
        manifest = load_manifest(entry.name)
        if manifest:
            out.append(manifest)
    return out


def is_installed(pkg_id: str) -> bool:
    pkg_id = validate_pkg_id(pkg_id)
    manifest = load_manifest(pkg_id)
    if manifest is None:
        return False
    if manifest["type"] == "app":
        return (installed_dir("apps") / pkg_id / "index.html").is_file()
    return (installed_dir("skins") / (pkg_id + ".json")).is_file()


def catalog() -> dict[str, Any]:
    """Каталог магазину: усі пакети + прапорець «встановлено»."""
    items = []
    with _store_lock:
        for manifest in _manifests():
            pkg_id = manifest["id"]
            item = dict(manifest)
            item["installed"] = is_installed(pkg_id)
            items.append(item)
    return {"packages": items}


def _count_files(path: Path) -> int:
    return sum(1 for p in path.rglob("*") if p.is_file())


def install(pkg_id: str) -> dict[str, Any]:
    """Встановлює пакет: копію packages/<id>/ → installed/<kind>/<id>.

    Застосунки копіюються ЦІЛКОМ (index.html + будь-які файли): екран мусить
    працювати без мережі, тож усі ассети їдуть разом із пакетом.
    """
    with _store_lock:
        manifest = load_manifest(pkg_id)
        if manifest is None:
            raise StoreError("Пакет не знайдено або зіпсований", code="not_found")
        src = packages_dir() / pkg_id
        dst = installed_dir("apps") / pkg_id if manifest["type"] == "app" else None
        try:
            if manifest["type"] == "app":
                n_files = _count_files(src)
                if n_files > MAX_PACKAGE_FILES:
                    raise StoreError("Пакет завеликий", code="too_large")
                dst.parent.mkdir(parents=True, exist_ok=True)
                if dst.exists():
                    shutil.rmtree(dst)
                shutil.copytree(src, dst)
            else:
                # Скін — це маніфест зі змінними; у installed лишаємо його копію
                dst = installed_dir("skins") / (pkg_id + ".json")
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(src / "package.json", dst)
        except StoreError:
            raise
        except OSError as exc:
            log.exception("Не вдалося встановити пакет %s", pkg_id)
            raise StoreError("Помилка файлової системи при встановленні", code="io_error") from exc
        log.info("📦 Магазин: встановлено %s (%s)", pkg_id, manifest["type"])
        result = dict(manifest)
        result["installed"] = True
        return result


def uninstall(pkg_id: str) -> dict[str, Any]:
    """Прибирає встановлений пакет (тільки з installed/, вихідники лишаються)."""
    with _store_lock:
        manifest = load_manifest(pkg_id)
        if manifest is None:
            raise StoreError("Пакет не знайдено", code="not_found")
        try:
            if manifest["type"] == "app":
                dst = installed_dir("apps") / pkg_id
                if dst.exists():
                    shutil.rmtree(dst)
            else:
                dst = installed_dir("skins") / (pkg_id + ".json")
                if dst.exists():
                    dst.unlink()
        except OSError as exc:
            log.exception("Не вдалося видалити пакет %s", pkg_id)
            raise StoreError("Помилка файлової системи при видаленні", code="io_error") from exc
        log.info("🗑 Магазин: видалено %s", pkg_id)
        return {"ok": True, "id": pkg_id}


def installed_apps() -> list[dict[str, Any]]:
    """Маніфести ВСТАНОВЛЕНИХ застосунків — їх показує шухляда екрана."""
    out: list[dict[str, Any]] = []
    for manifest in _manifests():
        if manifest["type"] == "app" and is_installed(manifest["id"]):
            out.append(manifest)
    return out


def installed_skins() -> list[dict[str, Any]]:
    """Встановлені скіни (повні маніфесті зі змінними)."""
    out: list[dict[str, Any]] = []
    for manifest in _manifests():
        if manifest["type"] == "skin" and is_installed(manifest["id"]):
            out.append(manifest)
    return out
