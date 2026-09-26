"""
Claude Bot — the device store for the screen.

Packages install straight from the device (/screen -> Apps -> Store). Two
kinds:
- app  — a screen app: a folder with `package.json` and an HTML entry. Once
         installed it shows up in the app drawer and opens in an iframe at
         `/store-apps/<id>/index.html` (the installed/apps folder).
- skin — a set of theme CSS variables (--bg, --accent, ...) the screen applies
         to the whole interface at once.

Skills and MCP tools live in a SEPARATE circuit (OpenClaw: `openclaw skills
install`, the curated MCP catalog). The screen store shows them too, but via
the existing /api/store endpoints, not through this module.

Two sources of packages, one catalog:
  store/packages/<id>/   — built-in packages, in the repository (trusted)
  store/shared/<id>/     — packages imported from a .cbp file (untrusted)

A `.cbp` ("Claude Bot Package") is a plain zip of a package folder with
`package.json` at its root. It exists so an app can be handed to someone as
one file — sent in a chat, dropped on the dashboard — instead of as a folder
in a git repository. Built-in and shared packages differ only in trust:
shared apps are served sandboxed with no network (see `shared_app_csp`),
because whoever made the file is not us.

Installed state lives on disk, nothing else:
  store/installed/apps/<id>/…     — installed apps (runtime copies)
  store/installed/skins/<id>.json — installed skins (runtime copies)

A package is installed if its folder/file exists in installed/. Uninstall is
deleting it.
"""

from __future__ import annotations

import io
import json
import logging
import re
import shutil
import stat
import sys
import tempfile
import zipfile
from pathlib import Path, PurePosixPath
from threading import Lock
from typing import Any

import app_config

log = logging.getLogger("virtual_bot.screen_store")

# Lowercase letters, digits, dashes: safe both as a folder name and in a URL.
PKG_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,31}$")

# Unknown types are skipped quietly so a stray file in packages/ cannot break
# the whole catalog.
PKG_TYPES = ("app", "skin")

MAX_MANIFEST_BYTES = 16_000
MAX_PACKAGE_FILES = 200
# A package unpacks onto a Pi 3 SD card and is copied again on install, so
# the ceiling is about wear and space, not about what a browser can load.
MAX_UNPACKED_BYTES = 8 * 1024 * 1024
# Compressed .cbp limit: checked before the zip is even opened.
MAX_ARCHIVE_BYTES = 4 * 1024 * 1024

CBP_SUFFIX = ".cbp"
CBP_MIME = "application/vnd.claude-bot.package+zip"

# Store shelves. Closed list: the screen has a fixed row of chips, and a free
# string would give every author their own spelling of "games".
CATEGORIES = ("games", "tools", "media", "health", "fun", "system")

# Skin variables are a closed set of plain colours: anything wider would let a
# skin hide text (transparent), or smuggle url() into the screen's CSS.
SKIN_VARS = ("--bg", "--panel", "--line", "--text", "--muted", "--accent", "--ok", "--off")
_HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")

# Manifest text fields and how long each may be. They end up in the store
# list on a 320px screen, so the caps are generous for a UI but tiny for abuse.
_TEXT_FIELDS = {"label": 40, "description": 200, "author": 60, "version": 20, "icon": 32, "tint": 7, "entry": 64}

_store_lock = Lock()


class StoreError(Exception):
    """A handled store error. `code` is stable and the screen localises it;
    the message is for logs and API clients."""

    def __init__(self, message: str, *, code: str = "store_error") -> None:
        super().__init__(message)
        self.code = code


def _store_dir() -> Path:
    return Path(app_config.STORE_DIR)


def packages_dir() -> Path:
    return _store_dir() / "packages"


def shared_dir() -> Path:
    return _store_dir() / "shared"


def installed_dir(kind: str) -> Path:
    return _store_dir() / "installed" / kind


def validate_pkg_id(pkg_id: str) -> str:
    """Validate an id: without this, /../ and reserved names would reach a path."""
    pkg_id = (pkg_id or "").strip()
    if not PKG_ID_RE.match(pkg_id):
        raise StoreError("invalid package id", code="invalid_id")
    return pkg_id


def _source_root(pkg_id: str) -> tuple[Path, str] | None:
    """Where a package's files live, and which source it came from.

    Built-in wins: import refuses built-in ids, but if a shared folder with the
    same id got there by hand, the repository copy is the one we trust.
    """
    builtin = packages_dir() / pkg_id
    if (builtin / "package.json").is_file():
        return builtin, "builtin"
    shared = shared_dir() / pkg_id
    if (shared / "package.json").is_file():
        return shared, "shared"
    return None


def check_manifest(manifest: Any, pkg_id: str | None = None) -> dict[str, Any]:
    """Structural check shared by the catalog and by import.

    Raises StoreError; returns the manifest unchanged when it is acceptable.
    """
    if not isinstance(manifest, dict) or manifest.get("type") not in PKG_TYPES:
        raise StoreError("manifest must be an object with type app or skin", code="bad_manifest")
    mid = manifest.get("id")
    if not isinstance(mid, str) or not PKG_ID_RE.match(mid):
        raise StoreError("manifest id is invalid", code="bad_manifest")
    if pkg_id is not None and mid != pkg_id:
        # The id inside the file guards against a folder copied under a
        # different name with someone else's id inside.
        raise StoreError("manifest id does not match its folder", code="bad_manifest")
    for field, limit in _TEXT_FIELDS.items():
        value = manifest.get(field)
        if value is not None and (not isinstance(value, str) or len(value) > limit):
            raise StoreError(f"manifest field {field} is invalid", code="bad_manifest")
    locales = manifest.get("locales")
    if locales is not None:
        if not isinstance(locales, dict):
            raise StoreError("manifest locales must be an object", code="bad_manifest")
        for lang, strings in locales.items():
            if not isinstance(strings, dict) or not re.match(r"^[a-z]{2}$", str(lang)):
                raise StoreError("manifest locales are invalid", code="bad_manifest")
            for field in ("label", "description"):
                value = strings.get(field)
                if value is not None and (not isinstance(value, str) or len(value) > _TEXT_FIELDS[field]):
                    raise StoreError("manifest locales are invalid", code="bad_manifest")
    category = manifest.get("category")
    if category is not None and category not in CATEGORIES:
        raise StoreError("unknown category", code="bad_manifest")
    if manifest["type"] == "app":
        entry = manifest.get("entry") or "index.html"
        if not _safe_member(entry) or not entry.endswith(".html"):
            raise StoreError("entry must be a relative .html path", code="bad_manifest")
    else:
        variables = manifest.get("vars")
        if not isinstance(variables, dict) or not variables:
            raise StoreError("skin needs vars", code="bad_manifest")
        for name, value in variables.items():
            if name not in SKIN_VARS or not isinstance(value, str) or not _HEX_COLOR.match(value):
                raise StoreError(f"skin var {name} is not allowed", code="bad_manifest")
    return manifest


def load_manifest(pkg_id: str) -> dict[str, Any] | None:
    """Read <source>/<id>/package.json; None if missing or broken."""
    pkg_id = validate_pkg_id(pkg_id)
    found = _source_root(pkg_id)
    if found is None:
        return None
    root, source = found
    try:
        raw = (root / "package.json").read_bytes()
    except OSError:
        return None
    if len(raw) > MAX_MANIFEST_BYTES:
        return None
    try:
        manifest = check_manifest(json.loads(raw), pkg_id)
    except (ValueError, StoreError):
        return None
    manifest = dict(manifest)
    manifest["source"] = source
    return manifest


def _manifests() -> list[dict[str, Any]]:
    """Every valid manifest from both sources, built-in first, by id."""
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for base in (packages_dir(), shared_dir()):
        try:
            entries = sorted(base.iterdir())
        except OSError:
            continue
        for entry in entries:
            if not entry.is_dir() or entry.name in seen or not PKG_ID_RE.match(entry.name):
                continue
            manifest = load_manifest(entry.name)
            if manifest:
                seen.add(entry.name)
                out.append(manifest)
    return out


def is_installed(pkg_id: str) -> bool:
    pkg_id = validate_pkg_id(pkg_id)
    manifest = load_manifest(pkg_id)
    if manifest is None:
        return False
    if manifest["type"] == "app":
        entry = manifest.get("entry") or "index.html"
        return (installed_dir("apps") / pkg_id / entry).is_file()
    return (installed_dir("skins") / (pkg_id + ".json")).is_file()


def is_shared(pkg_id: str) -> bool:
    """True for an imported (untrusted) package. Used by the server to decide
    how to serve the installed app."""
    try:
        found = _source_root(validate_pkg_id(pkg_id))
    except StoreError:
        return False
    return bool(found and found[1] == "shared")


def catalog() -> dict[str, Any]:
    """The store catalog: every package plus an `installed` flag."""
    items = []
    with _store_lock:
        for manifest in _manifests():
            item = dict(manifest)
            item["installed"] = is_installed(manifest["id"])
            items.append(item)
    return {"packages": items, "categories": list(CATEGORIES)}


def _package_files(root: Path) -> list[Path]:
    """Files that belong to a package: no dotfiles (.DS_Store and friends),
    no symlinks (a link could point anywhere on the device)."""
    out = []
    for path in sorted(root.rglob("*")):
        rel = path.relative_to(root)
        if any(part.startswith(".") for part in rel.parts):
            continue
        if path.is_symlink() or not path.is_file():
            continue
        out.append(path)
    return out


def install(pkg_id: str) -> dict[str, Any]:
    """Install a package: copy <source>/<id>/ -> installed/<kind>/<id>.

    Apps are copied WHOLE (entry + any assets): the screen must work offline,
    so every asset travels with the package.
    """
    with _store_lock:
        manifest = load_manifest(pkg_id)
        if manifest is None:
            raise StoreError("package not found or broken", code="not_found")
        src, _source = _source_root(pkg_id)
        try:
            if manifest["type"] == "app":
                files = _package_files(src)
                if len(files) > MAX_PACKAGE_FILES or sum(f.stat().st_size for f in files) > MAX_UNPACKED_BYTES:
                    raise StoreError("package too large", code="too_large")
                dst = installed_dir("apps") / pkg_id
                dst.parent.mkdir(parents=True, exist_ok=True)
                if dst.exists():
                    shutil.rmtree(dst)
                for file in files:
                    target = dst / file.relative_to(src)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(file, target)
            else:
                # A skin is just its manifest; installed/ keeps a copy of it.
                dst = installed_dir("skins") / (pkg_id + ".json")
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(src / "package.json", dst)
        except StoreError:
            raise
        except OSError as exc:
            log.exception("Failed to install package %s", pkg_id)
            raise StoreError("filesystem error during install", code="io_error") from exc
        log.info("Store: installed %s (%s)", pkg_id, manifest["type"])
        result = dict(manifest)
        result["installed"] = True
        return result


def uninstall(pkg_id: str) -> dict[str, Any]:
    """Remove an installed package (from installed/ only; sources stay)."""
    with _store_lock:
        manifest = load_manifest(pkg_id)
        if manifest is None:
            raise StoreError("package not found", code="not_found")
        _remove_installed(pkg_id, manifest["type"])
        log.info("Store: uninstalled %s", pkg_id)
        return {"ok": True, "id": pkg_id}


def _remove_installed(pkg_id: str, kind: str) -> None:
    try:
        if kind == "app":
            dst = installed_dir("apps") / pkg_id
            if dst.exists():
                shutil.rmtree(dst)
        else:
            dst = installed_dir("skins") / (pkg_id + ".json")
            if dst.exists():
                dst.unlink()
    except OSError as exc:
        log.exception("Failed to remove package %s", pkg_id)
        raise StoreError("filesystem error during removal", code="io_error") from exc


def installed_apps() -> list[dict[str, Any]]:
    """Manifests of INSTALLED apps — the screen's app drawer shows these."""
    return [m for m in _manifests() if m["type"] == "app" and is_installed(m["id"])]


def installed_skins() -> list[dict[str, Any]]:
    """Installed skins (full manifests with vars)."""
    return [m for m in _manifests() if m["type"] == "skin" and is_installed(m["id"])]


# ------------------------------------------------------------------ .cbp files

def _safe_member(name: str) -> bool:
    """A zip member name we are willing to write: relative, no `..`, no
    backslashes or drive letters, no dotfiles. Zip-slip starts exactly here."""
    if not name or "\\" in name or name.startswith("/") or ":" in name:
        return False
    parts = PurePosixPath(name).parts
    if not parts or any(p in ("", ".", "..") or p.startswith(".") for p in parts):
        return False
    return len(name) <= 200


def pack(pkg_id: str) -> tuple[str, bytes]:
    """Build a .cbp for a package from either source. Returns (filename, bytes).

    Member order and timestamps are fixed, so packing the same folder twice
    gives the same file — a shared package can be compared by hash.
    """
    pkg_id = validate_pkg_id(pkg_id)
    manifest = load_manifest(pkg_id)
    if manifest is None:
        raise StoreError("package not found or broken", code="not_found")
    root, _source = _source_root(pkg_id)
    return _pack_dir(root, manifest)


def _pack_dir(root: Path, manifest: dict[str, Any]) -> tuple[str, bytes]:
    files = _package_files(root)
    if len(files) > MAX_PACKAGE_FILES:
        raise StoreError("package too large", code="too_large")
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        # package.json first: a reader can identify the file from its head.
        ordered = sorted(files, key=lambda p: (p.name != "package.json" or p.parent != root, str(p)))
        for file in ordered:
            info = zipfile.ZipInfo(file.relative_to(root).as_posix(), date_time=(2020, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (stat.S_IFREG | 0o644) << 16
            archive.writestr(info, file.read_bytes())
    data = buffer.getvalue()
    if len(data) > MAX_ARCHIVE_BYTES:
        raise StoreError("package too large", code="too_large")
    version = re.sub(r"[^0-9A-Za-z.]", "", str(manifest.get("version") or "")) or "0"
    return f"{manifest['id']}-{version}{CBP_SUFFIX}", data


def inspect_archive(data: bytes) -> tuple[dict[str, Any], dict[str, bytes]]:
    """Validate a .cbp completely, in memory. Returns (manifest, files).

    Nothing touches the disk here: a file that fails any check is rejected
    before a single byte of it is written.
    """
    if not data or len(data) > MAX_ARCHIVE_BYTES:
        raise StoreError("archive is empty or too large", code="too_large")
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise StoreError("not a .cbp archive", code="bad_archive") from exc

    with archive:
        infos = [i for i in archive.infolist() if not i.is_dir()]
        if not infos:
            raise StoreError("archive is empty", code="bad_archive")
        if len(infos) > MAX_PACKAGE_FILES:
            raise StoreError("too many files", code="too_large")

        # Silently dropped: macOS Finder litter. Anything else unsafe is fatal.
        junk = re.compile(r"(^|/)(__MACOSX/|\.DS_Store$)")
        infos = [i for i in infos if not junk.search(i.filename)]
        names = [i.filename for i in infos]
        # Accept a zip of the folder itself (id/package.json) as well as one of
        # its contents: both are what "zip it and send it" produces by hand.
        prefix = ""
        if "package.json" not in names:
            tops = {n.split("/", 1)[0] for n in names}
            if len(tops) == 1 and f"{next(iter(tops))}/package.json" in names:
                prefix = next(iter(tops)) + "/"
            else:
                raise StoreError("package.json missing at the archive root", code="bad_archive")

        files: dict[str, bytes] = {}
        total = 0
        for info in infos:
            name = info.filename[len(prefix):]
            mode = info.external_attr >> 16
            if stat.S_ISLNK(mode):
                raise StoreError("symlinks are not allowed", code="bad_archive")
            if not _safe_member(name):
                raise StoreError(f"unsafe path in archive: {info.filename!r}", code="bad_archive")
            if info.flag_bits & 0x1:
                raise StoreError("encrypted archives are not supported", code="bad_archive")
            # Declared size first (cheap), then the real read is capped too:
            # a zip header can lie about sizes, which is how zip bombs work.
            total += info.file_size
            if total > MAX_UNPACKED_BYTES:
                raise StoreError("package too large", code="too_large")
            with archive.open(info) as handle:
                content = handle.read(MAX_UNPACKED_BYTES + 1)
            if len(content) != info.file_size:
                raise StoreError("archive entry size mismatch", code="bad_archive")
            files[name] = content

    raw_manifest = files.get("package.json", b"")
    if len(raw_manifest) > MAX_MANIFEST_BYTES:
        raise StoreError("manifest too large", code="bad_manifest")
    try:
        manifest = check_manifest(json.loads(raw_manifest))
    except ValueError as exc:
        raise StoreError("package.json is not valid JSON", code="bad_manifest") from exc
    if manifest["type"] == "app" and (manifest.get("entry") or "index.html") not in files:
        raise StoreError("entry file missing from archive", code="bad_manifest")
    return manifest, files


def import_archive(data: bytes, *, install_now: bool = False) -> dict[str, Any]:
    """Unpack a validated .cbp into store/shared/<id>/ (replacing an older one).

    Built-in ids are refused: an imported file must not be able to replace the
    repository's YouTube app with its own and inherit its trust.
    """
    manifest, files = inspect_archive(data)
    pkg_id = manifest["id"]
    with _store_lock:
        if (packages_dir() / pkg_id / "package.json").is_file():
            raise StoreError("a built-in package already uses this id", code="id_taken")
        base = shared_dir()
        try:
            base.mkdir(parents=True, exist_ok=True)
            staging = Path(tempfile.mkdtemp(prefix=f".{pkg_id}-", dir=base))
            try:
                for name, content in files.items():
                    target = staging / name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(content)
                final = base / pkg_id
                previous = None
                if final.exists():
                    previous = base / f".{pkg_id}-old"
                    if previous.exists():
                        shutil.rmtree(previous)
                    final.rename(previous)
                # Rename, not copy: a crash halfway leaves either the old
                # package or the new one, never a mix of both.
                staging.rename(final)
                if previous is not None:
                    shutil.rmtree(previous, ignore_errors=True)
            except BaseException:
                shutil.rmtree(staging, ignore_errors=True)
                raise
            was_installed = (
                (installed_dir("apps") / pkg_id).exists()
                if manifest["type"] == "app"
                else (installed_dir("skins") / f"{pkg_id}.json").exists()
            )
        except OSError as exc:
            log.exception("Failed to import package %s", pkg_id)
            raise StoreError("filesystem error during import", code="io_error") from exc
    log.info("Store: imported shared package %s %s", pkg_id, manifest.get("version"))
    # An update to something already installed refreshes the installed copy,
    # otherwise the drawer would keep running the old version.
    if install_now or was_installed:
        return install(pkg_id)
    result = dict(manifest)
    result["source"] = "shared"
    result["installed"] = False
    return result


def remove_shared(pkg_id: str) -> dict[str, Any]:
    """Delete an imported package completely: its installed copy and source."""
    pkg_id = validate_pkg_id(pkg_id)
    with _store_lock:
        found = _source_root(pkg_id)
        if found is None or found[1] != "shared":
            raise StoreError("not a shared package", code="not_found")
        manifest = load_manifest(pkg_id)
        _remove_installed(pkg_id, (manifest or {}).get("type", "app"))
        try:
            shutil.rmtree(found[0])
        except OSError as exc:
            raise StoreError("filesystem error during removal", code="io_error") from exc
    log.info("Store: removed shared package %s", pkg_id)
    return {"ok": True, "id": pkg_id}


# Served with every shared app's files. `sandbox allow-scripts` gives the page
# an opaque origin even if someone opens it outside the screen's iframe, so it
# cannot read the screen's storage or call the bot's API as the screen;
# `connect-src 'none'` keeps it offline, so it cannot report what it sees.
SHARED_APP_CSP = (
    "sandbox allow-scripts; "
    "default-src 'none'; "
    "script-src 'self' 'unsafe-inline'; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob:; "
    "media-src 'self' data: blob:; "
    "font-src 'self' data:; "
    "connect-src 'none'; "
    "frame-src 'none'; "
    "form-action 'none'"
)


def shared_app_csp(path: str) -> str | None:
    """CSP for a /store-apps/<id>/... request, or None for trusted apps."""
    first = path.strip("/").split("/", 1)[0]
    return SHARED_APP_CSP if first and is_shared(first) else None


# ------------------------------------------------------------------ CLI

def _cli(argv: list[str]) -> int:
    """`python screen_store.py pack <folder> [-o out.cbp]` — the author's side
    of sharing: turn a package folder into one file to send someone.
    `python screen_store.py check <file.cbp>` — the receiver's side."""
    import argparse

    parser = argparse.ArgumentParser(prog="screen_store.py", description="Claude Bot package tool")
    sub = parser.add_subparsers(dest="cmd", required=True)
    p_pack = sub.add_parser("pack", help="pack a package folder into a .cbp file")
    p_pack.add_argument("folder")
    p_pack.add_argument("-o", "--output")
    p_check = sub.add_parser("check", help="validate a .cbp file without installing it")
    p_check.add_argument("file")
    args = parser.parse_args(argv)

    try:
        if args.cmd == "pack":
            root = Path(args.folder)
            manifest = check_manifest(json.loads((root / "package.json").read_text("utf-8")), root.resolve().name)
            name, data = _pack_dir(root, manifest)
            out = Path(args.output or name)
            inspect_archive(data)  # the file we hand out must pass our own import
            out.write_bytes(data)
            print(f"{out} ({len(data)} bytes)")
        else:
            manifest, files = inspect_archive(Path(args.file).read_bytes())
            print(f"ok: {manifest['id']} {manifest.get('version', '')} ({manifest['type']}, {len(files)} files)")
    except (StoreError, OSError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(_cli(sys.argv[1:]))
