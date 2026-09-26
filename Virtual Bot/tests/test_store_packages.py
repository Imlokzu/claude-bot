"""
Lint for every package in store/packages/.

The store is meant to take packages from other people (a shared .cbp file),
so the rules a package must follow are checked here once, for all of them,
instead of per-app tests that only cover whatever was written first. A new
package that breaks one of these is not "almost done" — it is not done.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

import app_config
import screen_store

PACKAGES = Path(app_config.STORE_DIR) / "packages"
ICONS_JS = Path(app_config.STATIC_DIR) / "screen" / "icons.js"


def _package_dirs() -> list[Path]:
    return sorted(p for p in PACKAGES.iterdir() if (p / "package.json").is_file())


def _app_dirs() -> list[Path]:
    return [p for p in _package_dirs() if json.loads((p / "package.json").read_text("utf-8")).get("type") == "app"]


def _icon_names() -> set[str]:
    text = ICONS_JS.read_text("utf-8")
    block = text.split("const PATHS = {", 1)[1].split("\n};", 1)[0]
    return set(re.findall(r"^  ([a-z_]+):", block, re.M))


def _strip_comments(raw: str) -> str:
    """Markup without comments: comments may quote an emoji to explain why
    it is banned, and that must not count as using one."""
    raw = re.sub(r"<!--.*?-->", "", raw, flags=re.S)
    raw = re.sub(r"/\*.*?\*/", "", raw, flags=re.S)
    raw = re.sub(r"^\s*//.*$", "", raw, flags=re.M)
    return raw


# Pictographs, dingbats, arrows-as-emoji, media controls. Browsers paint these
# as colour bitmaps that ignore the theme and the icon stroke width.
_EMOJI = re.compile(
    "[\U0001F000-\U0001FAFF☀-➿⬀-⯿⏩-⏺←-⇿■-◿✀-➿]"
)
_CYRILLIC = re.compile("[Ѐ-ӿ]")


@pytest.mark.parametrize("pkg", _package_dirs(), ids=lambda p: p.name)
def test_manifest_is_complete(pkg: Path):
    manifest = screen_store.load_manifest(pkg.name)
    assert manifest is not None, "manifest rejected by screen_store.load_manifest"
    for field in ("label", "version", "author", "description", "icon"):
        assert manifest.get(field), f"missing {field}"
    assert re.match(r"^\d+\.\d+\.\d+$", manifest["version"]), "version must be semver x.y.z"
    assert manifest["icon"] in _icon_names(), f"icon {manifest['icon']!r} is not in static/screen/icons.js"
    # Every user-visible manifest string has an English twin: the label and
    # description are shown in the store in whichever language the screen uses.
    en = (manifest.get("locales") or {}).get("en") or {}
    assert en.get("label") and en.get("description"), "locales.en.label/description required"
    if manifest["type"] == "app":
        assert manifest.get("category") in screen_store.CATEGORIES, "category must be one of screen_store.CATEGORIES"
        assert (pkg / manifest.get("entry", "index.html")).is_file(), "entry file missing"


@pytest.mark.parametrize("pkg", _app_dirs(), ids=lambda p: p.name)
def test_app_markup_rules(pkg: Path):
    raw = (pkg / "index.html").read_text("utf-8")
    markup = _strip_comments(raw)

    found = sorted(set(_EMOJI.findall(markup)))
    assert not found, f"emoji/pictographs in UI: {found}"

    # Light theme arrives with the skin message; without these the app stays
    # dark on a light screen.
    assert ':root[data-theme="light"]' in markup
    assert "dataset.theme" in markup
    assert "botSkin" in markup

    # Offline: the Pi may have no network, and a shared package must not phone
    # home. Only the SVG namespace string is allowed.
    urls = set(re.findall(r"https?://[^\s\"'`)]+", markup)) - {"http://www.w3.org/2000/svg"}
    assert not urls, f"external URLs: {urls}"

    for banned in ("alert(", "confirm(", "prompt("):
        assert banned not in markup, f"{banned} blocks the kiosk screen"

    # i18n: both dictionaries, and the language comes from the screen.
    assert re.search(r"\buk\s*:\s*\{", markup) and re.search(r"\ben\s*:\s*\{", markup), "needs uk and en dictionaries"
    assert "botScreenLang" in markup, "must start in the screen's language (localStorage botScreenLang)"

    # No hardcoded Ukrainian outside scripts: static text is filled from the
    # dictionary, otherwise the English screen shows Ukrainian labels.
    html_only = re.sub(r"<script.*?</script>", "", markup, flags=re.S)
    assert not _CYRILLIC.search(html_only), "hardcoded Cyrillic in HTML — use data-i18n keys"


@pytest.mark.parametrize("pkg", _app_dirs(), ids=lambda p: p.name)
def test_app_fits_package_limits(pkg: Path):
    files = [p for p in pkg.rglob("*") if p.is_file()]
    assert len(files) <= screen_store.MAX_PACKAGE_FILES
    assert sum(p.stat().st_size for p in files) <= screen_store.MAX_UNPACKED_BYTES
