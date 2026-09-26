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


# ------------------------------------------------------------------ .cbp sharing
#
# A .cbp is how an app travels between people: one file, sent in a chat. The
# receiving bot has to treat it as hostile input, so most of these tests are
# about what must NOT get through.

import io
import json
import stat
import zipfile


def _cbp(files: dict[str, bytes | str], *, symlink: str | None = None) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, content in files.items():
            archive.writestr(name, content)
        if symlink:
            info = zipfile.ZipInfo(symlink)
            info.external_attr = (stat.S_IFLNK | 0o777) << 16
            archive.writestr(info, "/etc/passwd")
    return buffer.getvalue()


def _manifest(pkg_id: str = "friend-app", **extra) -> str:
    data = {"id": pkg_id, "type": "app", "label": "Friend", "version": "1.2.0",
            "author": "A friend", "description": "Shared by a friend", "icon": "star",
            "category": "fun", "entry": "index.html"}
    data.update(extra)
    return json.dumps(data)


def test_pack_then_import_roundtrip(store_dir):
    """What one bot exports, another bot imports: the whole point of the format."""
    name, data = screen_store.pack("metronome")
    assert name.startswith("metronome-") and name.endswith(".cbp")
    # Deterministic: same folder, same bytes — a shared file can be compared by hash.
    assert screen_store.pack("metronome")[1] == data

    manifest, files = screen_store.inspect_archive(data)
    assert manifest["id"] == "metronome"
    assert "index.html" in files and "package.json" in files


def test_import_installs_as_shared(store_dir):
    data = _cbp({"package.json": _manifest(), "index.html": "<p>hi</p>", "img/a.png": b"\x89PNG"})
    result = screen_store.import_archive(data, install_now=True)
    assert result["installed"] is True and result["source"] == "shared"
    assert (store_dir / "shared" / "friend-app" / "img" / "a.png").is_file()
    assert (store_dir / "installed" / "apps" / "friend-app" / "index.html").is_file()
    entry = next(p for p in screen_store.catalog()["packages"] if p["id"] == "friend-app")
    assert entry["source"] == "shared"
    assert screen_store.is_shared("friend-app") and not screen_store.is_shared("metronome")


def test_import_accepts_zipped_folder(store_dir):
    """Zipping the folder by hand puts everything under friend-app/ — accept it."""
    data = _cbp({"friend-app/package.json": _manifest(), "friend-app/index.html": "x",
                 "__MACOSX/friend-app/._index.html": "junk"})
    manifest, files = screen_store.inspect_archive(data)
    assert set(files) == {"package.json", "index.html"}


@pytest.mark.parametrize("evil", ["../escape.html", "/abs.html", "a/../../b.html", "C:/win.html", "a\\b.html", ".hidden/x"])
def test_import_rejects_unsafe_paths(store_dir, evil):
    data = _cbp({"package.json": _manifest(), "index.html": "x", evil: "boom"})
    with pytest.raises(screen_store.StoreError) as err:
        screen_store.import_archive(data)
    assert err.value.code == "bad_archive"
    assert not (store_dir / "shared" / "friend-app").exists()


def test_import_rejects_symlinks(store_dir):
    data = _cbp({"package.json": _manifest(), "index.html": "x"}, symlink="link")
    with pytest.raises(screen_store.StoreError):
        screen_store.import_archive(data)


def test_import_rejects_zip_bomb(store_dir, monkeypatch):
    monkeypatch.setattr(screen_store, "MAX_UNPACKED_BYTES", 1000)
    data = _cbp({"package.json": _manifest(), "index.html": "a" * 5000})
    with pytest.raises(screen_store.StoreError) as err:
        screen_store.import_archive(data)
    assert err.value.code == "too_large"


def test_import_cannot_replace_builtin(store_dir):
    """A file claiming to be the built-in YouTube app must not inherit its trust."""
    data = _cbp({"package.json": _manifest("youtube"), "index.html": "fake"})
    with pytest.raises(screen_store.StoreError) as err:
        screen_store.import_archive(data)
    assert err.value.code == "id_taken"


@pytest.mark.parametrize("patch", [
    {"type": "plugin"}, {"id": "Bad Id"}, {"entry": "../x.html"}, {"entry": "run.sh"},
    {"category": "casino"}, {"label": "x" * 500},
])
def test_import_rejects_bad_manifest(store_dir, patch):
    data = _cbp({"package.json": _manifest(**patch), "index.html": "x"})
    with pytest.raises(screen_store.StoreError):
        screen_store.import_archive(data)


def test_import_rejects_skin_with_css_injection(store_dir):
    """Skin vars go into the screen's CSS; only plain #rrggbb may pass."""
    skin = json.dumps({"id": "evil-skin", "type": "skin", "label": "E", "version": "1.0.0",
                       "vars": {"--bg": "url(https://tracker/x)"}})
    with pytest.raises(screen_store.StoreError):
        screen_store.import_archive(_cbp({"package.json": skin}))
    skin = json.dumps({"id": "evil-skin", "type": "skin", "label": "E", "version": "1.0.0",
                       "vars": {"--unknown": "#000000"}})
    with pytest.raises(screen_store.StoreError):
        screen_store.import_archive(_cbp({"package.json": skin}))


def test_reimport_updates_installed_copy(store_dir):
    """A new version of an installed app must replace what the drawer runs."""
    screen_store.import_archive(_cbp({"package.json": _manifest(), "index.html": "v1"}), install_now=True)
    screen_store.import_archive(_cbp({"package.json": _manifest(version="1.3.0"), "index.html": "v2"}))
    installed = store_dir / "installed" / "apps" / "friend-app" / "index.html"
    assert installed.read_text() == "v2"


def test_remove_shared_deletes_everything(store_dir):
    screen_store.import_archive(_cbp({"package.json": _manifest(), "index.html": "x"}), install_now=True)
    screen_store.remove_shared("friend-app")
    assert not (store_dir / "shared" / "friend-app").exists()
    assert not (store_dir / "installed" / "apps" / "friend-app").exists()
    with pytest.raises(screen_store.StoreError):
        screen_store.remove_shared("metronome")  # built-in: uninstall only


def test_cbp_api_and_sandbox(store_dir):
    """Export, import, and the sandbox headers that make importing safe."""
    from main import app

    with TestClient(app) as client:
        exported = client.get("/api/screen-store/export", params={"id": "metronome"})
        assert exported.status_code == 200
        assert "metronome-" in exported.headers["content-disposition"]

        data = _cbp({"package.json": _manifest(), "index.html": "<p>hi</p>"})
        imported = client.post("/api/screen-store/import", content=data)
        assert imported.status_code == 200, imported.text
        assert imported.json()["installed"] is True

        taken = client.post("/api/screen-store/import",
                            content=_cbp({"package.json": _manifest("youtube"), "index.html": "x"}))
        assert taken.status_code == 409
        assert taken.json()["detail"]["code"] == "id_taken"

        garbage = client.post("/api/screen-store/import", content=b"not a zip")
        assert garbage.status_code == 400

        # Shared app: sandboxed, offline. Built-in app: no such header.
        shared = client.get("/store-apps/friend-app/index.html")
        assert shared.status_code == 200
        csp = shared.headers.get("content-security-policy", "")
        assert "sandbox allow-scripts" in csp and "connect-src 'none'" in csp
        client.post("/api/screen-store/install", json={"id": "metronome"})
        builtin = client.get("/store-apps/metronome/index.html")
        assert "content-security-policy" not in builtin.headers

        # A request from a sandboxed page cannot change state.
        blocked = client.post("/api/screen-store/uninstall", json={"id": "metronome"},
                              headers={"Origin": "null"})
        assert blocked.status_code == 403

        removed = client.post("/api/screen-store/remove", json={"id": "friend-app"})
        assert removed.status_code == 200


def test_cli_pack_and_check(store_dir, tmp_path):
    out = tmp_path / "m.cbp"
    assert screen_store._cli(["pack", str(store_dir / "packages" / "metronome"), "-o", str(out)]) == 0
    assert screen_store._cli(["check", str(out)]) == 0
    (tmp_path / "bad.cbp").write_bytes(b"nope")
    assert screen_store._cli(["check", str(tmp_path / "bad.cbp")]) == 1
