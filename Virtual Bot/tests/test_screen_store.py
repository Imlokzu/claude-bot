"""
Тести магазину екрана: каталог, встановлення/видалення, захист id.

Використовуємо тимчасовий STORE_DIR: реальні store/installed/ тести не чіпають,
а packages/ читаються з репозиторію (вони — тестові дані самі по собі).
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import app_config
import screen_store


@pytest.fixture()
def store_dir(tmp_path, monkeypatch):
    """STORE_DIR у тимчасовій теці, але з КОПІЄЮ справжніх packages/ —
    інакше каталог порожній і тестує нічого."""
    import shutil

    target = tmp_path / "store"
    target.mkdir()
    real_packages = Path(app_config.STORE_DIR) / "packages"
    if real_packages.is_dir():
        shutil.copytree(real_packages, target / "packages")
    monkeypatch.setattr(app_config, "STORE_DIR", target)
    return target


def test_catalog_lists_repo_packages(store_dir):
    data = screen_store.catalog()
    ids = {p["id"] for p in data["packages"]}
    # Пакети-зразки з репозиторію: 2 застосунки + 3 скіни
    assert {"metronome", "pixel-paint", "skin-amoled", "skin-sunset", "skin-terminal"} <= ids
    for pkg in data["packages"]:
        assert pkg["type"] in ("app", "skin")
        assert pkg["installed"] is False


def test_install_and_uninstall_app(store_dir):
    result = screen_store.install("metronome")
    assert result["installed"] is True
    installed = store_dir / "installed" / "apps" / "metronome" / "index.html"
    assert installed.is_file()
    assert screen_store.is_installed("metronome")
    assert [p["id"] for p in screen_store.installed_apps()] == ["metronome"]

    screen_store.uninstall("metronome")
    assert not installed.exists()
    assert screen_store.installed_apps() == []


def test_install_skin_copies_manifest(store_dir):
    screen_store.install("skin-amoled")
    copied = store_dir / "installed" / "skins" / "skin-amoled.json"
    assert copied.is_file()
    assert screen_store.is_installed("skin-amoled")


def test_install_unknown_package_raises(store_dir):
    with pytest.raises(screen_store.StoreError):
        screen_store.install("no-such-package")


@pytest.mark.parametrize("bad", ["../escape", "UPPER", "", "a/b", "x" * 40, ".hidden"])
def test_invalid_ids_rejected(store_dir, bad):
    with pytest.raises(screen_store.StoreError):
        screen_store.install(bad)
    with pytest.raises(screen_store.StoreError):
        screen_store.uninstall(bad)


def test_reinstall_replaces_old_files(store_dir):
    screen_store.install("metronome")
    stale = store_dir / "installed" / "apps" / "metronome" / "old.bin"
    stale.write_text("залишок попередньої версії")
    screen_store.install("metronome")
    assert not stale.exists()
    assert (store_dir / "installed" / "apps" / "metronome" / "index.html").is_file()


def test_store_api_roundtrip(store_dir):
    from main import app

    with TestClient(app) as client:
        catalog = client.get("/api/screen-store/catalog")
        assert catalog.status_code == 200
        assert any(p["id"] == "metronome" for p in catalog.json()["packages"])

        miss = client.post("/api/screen-store/install", json={"id": "nope"})
        assert miss.status_code == 404

        ok = client.post("/api/screen-store/install", json={"id": "metronome"})
        assert ok.status_code == 200
        assert ok.json()["installed"] is True

        installed = client.get("/api/screen-store/installed")
        assert installed.status_code == 200
        assert [p["id"] for p in installed.json()["apps"]] == ["metronome"]

        gone = client.post("/api/screen-store/uninstall", json={"id": "metronome"})
        assert gone.status_code == 200
