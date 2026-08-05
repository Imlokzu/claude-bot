"""
«Клод Бот» — робоча тека бота на диску.

Це «руки» бота у файловій системі: власна тека, у якій він може створювати
проєкти, ігри, нотатки й тримати матеріали окремої сесії. Усі шляхи —
ВІДНОСНІ до кореня workspace/, вихід за корінь неможливий (symlink-и й ../
відсікаються в _resolve).

Особливий префікс `session/` вказує на теку поточної сесії
(workspace/sessions/<slug>) — так бот пише «session/plan.md», не знаючи
свого session_id. Активна сесія передається через ContextVar, як і brain.
"""

from __future__ import annotations

import hashlib
import re
import shutil
import time
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path
from typing import Iterator

from app_config import WORKSPACE_DIR

# Теки, які створюються одразу — щоб бот бачив, куди що класти
DEFAULT_FOLDERS = ("projects", "games", "notes", "downloads", "sessions")

TRASH_DIRNAME = ".trash"

MAX_READ_BYTES = 1_000_000     # більший файл у редакторі не відкриваємо
MAX_WRITE_BYTES = 2_000_000    # запобіжник проти запису «стіни» в теку
MAX_ENTRIES = 1000             # скільки записів віддаємо на одну теку

_SLUG_RE = re.compile(r"[^a-zA-Z0-9_-]")

_session_ctx: ContextVar[str] = ContextVar("workspace_session", default="")

README = """# Робоча тека Клода Бота

Це тека, якою бот користується сам: створює файли, проєкти, ігри, нотатки.

- `projects/`  — робочі проєкти
- `games/`     — ігри та експерименти
- `notes/`     — нотатки
- `downloads/` — те, що бот завантажив
- `sessions/`  — окрема тека для кожної сесії чату (бот звертається до неї як `session/…`)
- `.trash/`    — видалене (нічого не стирається назавжди, лише переїжджає сюди)
"""


# ---------------------------------------------------------------- сесії

def session_slug(session_id: str | None) -> str:
    """Ім'я теки сесії: читабельне, якщо id безпечний, інакше — sha256."""
    sid = (session_id or "").strip()
    if not sid:
        return "default"
    if _SLUG_RE.search(sid) or len(sid) > 40:
        return hashlib.sha256(sid.encode("utf-8")).hexdigest()[:16]
    return sid


@contextmanager
def set_session(session_id: str | None) -> Iterator[str]:
    """Активує сесію для поточного контексту (використовує /api/chat)."""
    slug = session_slug(session_id)
    token = _session_ctx.set(slug)
    try:
        yield slug
    finally:
        _session_ctx.reset(token)


def active_session_slug() -> str:
    return _session_ctx.get() or "default"


# ---------------------------------------------------------------- шляхи

def root() -> Path:
    """Корінь робочої теки; створюється разом зі стандартними підтеками."""
    base = WORKSPACE_DIR
    base.mkdir(parents=True, exist_ok=True)
    for name in DEFAULT_FOLDERS:
        (base / name).mkdir(exist_ok=True)
    readme = base / "README.md"
    if not readme.exists():
        readme.write_text(README, encoding="utf-8")
    return base.resolve()


def session_dir(session_id: str | None = None) -> Path:
    """Тека поточної (або вказаної) сесії; створюється за потреби."""
    slug = session_slug(session_id) if session_id is not None else active_session_slug()
    path = root() / "sessions" / slug
    path.mkdir(parents=True, exist_ok=True)
    return path


def _expand_session_prefix(rel: str) -> str:
    """`session` / `session/…` → реальний відносний шлях теки сесії."""
    parts = [p for p in rel.replace("\\", "/").split("/") if p not in ("", ".")]
    if parts and parts[0] == "session":
        session_dir()  # гарантуємо існування
        parts = ["sessions", active_session_slug(), *parts[1:]]
    return "/".join(parts)


def _resolve(rel: str | None, *, must_exist: bool = False) -> Path:
    """
    Відносний шлях → абсолютний усередині workspace/.

    Захист: спершу відсікаємо '..' на рівні компонентів, далі порівнюємо вже
    РОЗВʼЯЗАНИЙ шлях із коренем — тому символічне посилання назовні теж не
    пройде (resolve() йде за посиланням, і перевірка relative_to падає).
    """
    base = root()
    cleaned = _expand_session_prefix(rel or "")
    parts = [p for p in cleaned.split("/") if p not in ("", ".")]
    if any(p == ".." for p in parts):
        raise ValueError("Шлях не може виходити за межі робочої теки")

    target = (base / Path(*parts)) if parts else base
    resolved = target.resolve()
    if resolved != base and not resolved.is_relative_to(base):
        raise ValueError("Шлях не може виходити за межі робочої теки")
    if must_exist and not resolved.exists():
        raise FileNotFoundError(f"Немає такого шляху: {rel}")
    return resolved


def rel_path(path: Path) -> str:
    """Абсолютний шлях → відносний до кореня (для віддачі у фронтенд)."""
    base = root()
    resolved = path.resolve()
    return "" if resolved == base else resolved.relative_to(base).as_posix()


# ---------------------------------------------------------------- операції

def info() -> dict:
    """Де тека лежить на диску і які в ній верхні теки (для UI)."""
    base = root()
    return {
        "root": str(base),
        "session": active_session_slug(),
        "session_path": rel_path(session_dir()),
        "folders": [name for name in DEFAULT_FOLDERS],
    }


def _entry(path: Path) -> dict:
    stat = path.stat()
    is_dir = path.is_dir()
    return {
        "name": path.name,
        "path": rel_path(path),
        "type": "dir" if is_dir else "file",
        "size": 0 if is_dir else stat.st_size,
        "mtime": int(stat.st_mtime),
    }


def list_dir(rel: str = "") -> dict:
    """Вміст теки (не рекурсивно): спершу теки, далі файли — за алфавітом."""
    path = _resolve(rel, must_exist=True)
    if not path.is_dir():
        raise NotADirectoryError(f"Це не тека: {rel}")
    entries = []
    for child in sorted(path.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
        if child.name == TRASH_DIRNAME:
            continue
        try:
            entries.append(_entry(child))
        except OSError:  # зникло між iterdir і stat — просто пропускаємо
            continue
        if len(entries) >= MAX_ENTRIES:
            break
    return {"path": rel_path(path), "entries": entries}


def read_file(rel: str) -> dict:
    """Текст файлу для редактора. Бінарні й завеликі файли не віддаємо."""
    path = _resolve(rel, must_exist=True)
    if not path.is_file():
        raise IsADirectoryError(f"Це не файл: {rel}")
    size = path.stat().st_size
    if size > MAX_READ_BYTES:
        return {
            "path": rel_path(path),
            "size": size,
            "binary": False,
            "too_large": True,
            "content": "",
        }
    raw = path.read_bytes()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return {"path": rel_path(path), "size": size, "binary": True, "content": ""}
    return {"path": rel_path(path), "size": size, "binary": False, "content": text}


def write_file(rel: str, content: str, *, append: bool = False) -> dict:
    """Створює або перезаписує файл (батьківські теки — за потреби)."""
    text = content if isinstance(content, str) else str(content)
    if len(text.encode("utf-8")) > MAX_WRITE_BYTES:
        raise ValueError("Забагато тексту для одного файлу")
    path = _resolve(rel)
    if path == root():
        raise ValueError("Потрібне ім'я файлу")
    path.parent.mkdir(parents=True, exist_ok=True)
    if append and path.exists():
        with path.open("a", encoding="utf-8") as fh:
            fh.write(text)
    else:
        path.write_text(text, encoding="utf-8")
    return {"ok": True, "path": rel_path(path), "size": path.stat().st_size}


def make_dir(rel: str) -> dict:
    path = _resolve(rel)
    if path == root():
        raise ValueError("Потрібне ім'я теки")
    path.mkdir(parents=True, exist_ok=True)
    return {"ok": True, "path": rel_path(path)}


def delete(rel: str) -> dict:
    """
    Видалення = переїзд у .trash/ з міткою часу. Нічого не стирається
    назавжди: помилковий клік у панелі (чи бота) завжди можна відкотити.
    """
    path = _resolve(rel, must_exist=True)
    if path == root():
        raise ValueError("Корінь робочої теки видалити не можна")
    trash = root() / TRASH_DIRNAME
    trash.mkdir(exist_ok=True)
    target = trash / f"{int(time.time())}-{path.name}"
    counter = 1
    while target.exists():
        target = trash / f"{int(time.time())}-{counter}-{path.name}"
        counter += 1
    shutil.move(str(path), str(target))
    return {"ok": True, "trashed": rel_path(target)}


def rename(rel: str, new_name: str) -> dict:
    """Перейменування в межах тієї ж теки."""
    path = _resolve(rel, must_exist=True)
    name = (new_name or "").strip()
    if not name or "/" in name or "\\" in name or name in (".", ".."):
        raise ValueError("Некоректне ім'я")
    target = path.parent / name
    if target.exists():
        raise FileExistsError("Такий файл уже існує")
    path.rename(target)
    return {"ok": True, "path": rel_path(target)}
