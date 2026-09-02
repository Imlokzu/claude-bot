"""
«Клод Бот» — реєстр проєктів.

Проєкт — це іменована тека під workspace/projects/<slug>/, до якої можна
привʼязати кілька чатів (chat_store.set_project) і яка сама є «бібліотекою»
проєкту: усе, що бот там зберіг чи створив (картинки, файли сайту, нотатки),
видно одним списком через звичайні /api/workspace/* ендпоінти зі шляхом
projects/<slug>/….

Слаг (ім'я теки) — стабільний ідентифікатор проєкту й НЕ змінюється при
перейменуванні: назву для показу тримаємо окремо в projects/<slug>/.project.json,
інакше перейменування розірвало б звʼязок із чатами, які вже посилаються на
цей slug.
"""

from __future__ import annotations

import json
import re
import time
from pathlib import Path

import workspace

_META_NAME = ".project.json"
_SLUG_BAD_CHARS_RE = re.compile(r"[^a-z0-9_-]+")
_SLUG_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,50}$")
MAX_NAME = 80
# Скільки файлів проєкту сканувати заради «час останньої зміни» — досить
# для звичайного проєкту, а від «стіни» файлів рахунок не вішаємо.
_MTIME_SCAN_LIMIT = 300

# Назви здебільшого українські/російські — без транслітерації "Сайт котиків"
# перетворився б у порожній рядок (кирилиця не проходить [a-z0-9_-]) і всі
# такі проєкти звалились би в однаковий слаг "project", "project-2", ...
_TRANSLIT = {
    "а": "a", "б": "b", "в": "v", "г": "h", "ґ": "g", "д": "d", "е": "e", "є": "ie",
    "ж": "zh", "з": "z", "и": "y", "і": "i", "ї": "i", "й": "i", "к": "k", "л": "l",
    "м": "m", "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
    "ф": "f", "х": "kh", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "shch", "ь": "",
    "ю": "iu", "я": "ia", "ъ": "", "ы": "y", "э": "e", "ё": "e",
}


def _safe_slug(slug: str) -> str:
    """slug стає іменем теки, тож перевіряємо його суворо, як chat_store id."""
    s = (slug or "").strip()
    if not _SLUG_ID_RE.match(s):
        raise ValueError("Некоректний ідентифікатор проєкту")
    return s


def _projects_root() -> Path:
    """Код-проєкти живуть у власному корені (`code_dir`), не в workspace.

    Так кодинг-агент, який отримує цю теку як cwd, не бачить ні памʼяті й
    профілю користувача (brain/), ні особистих файлів бота (workspace/).
    """
    return workspace.code_root()


def _slugify(name: str) -> str:
    lowered = (name or "").strip().lower()
    translit = "".join(_TRANSLIT.get(ch, ch) for ch in lowered)
    base = _SLUG_BAD_CHARS_RE.sub("-", translit).strip("-")[:40]
    return base or "project"


def _read_meta(folder: Path) -> dict:
    meta_path = folder / _META_NAME
    if meta_path.is_file():
        try:
            return json.loads(meta_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            pass
    return {}


def _write_meta(folder: Path, meta: dict) -> None:
    tmp = folder / f"{_META_NAME}.tmp"
    tmp.write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    tmp.replace(folder / _META_NAME)


def _updated_at(folder: Path) -> int:
    best = folder.stat().st_mtime
    count = 0
    for child in folder.rglob("*"):
        if child.name == _META_NAME:
            continue
        try:
            best = max(best, child.stat().st_mtime)
        except OSError:
            continue
        count += 1
        if count >= _MTIME_SCAN_LIMIT:
            break
    return int(best)


def _as_dict(folder: Path) -> dict:
    meta = _read_meta(folder)
    try:
        created = int(meta.get("created") or int(folder.stat().st_ctime))
    except OSError:
        created = int(time.time())
    return {
        "id": folder.name,
        "name": meta.get("name") or folder.name,
        "created": created,
        "updated": _updated_at(folder),
    }


def list_projects() -> list[dict]:
    """Проєкти, найсвіжіші (за останньою зміною файлів) першими."""
    root = _projects_root()
    # Приховані теки — не проєкти: у корені коду поруч лежить власний .trash,
    # куди їдуть видалені проєкти, і він не має показуватись у списку.
    out = [
        _as_dict(folder)
        for folder in root.iterdir()
        if folder.is_dir() and not folder.name.startswith(".")
    ]
    out.sort(key=lambda p: -p["updated"])
    return out


def get_project(slug: str) -> dict:
    folder = _projects_root() / _safe_slug(slug)
    if not folder.is_dir():
        raise FileNotFoundError("Немає такого проєкту")
    return _as_dict(folder)


def create_project(name: str) -> dict:
    clean = " ".join((name or "").split())[:MAX_NAME] or "Без назви"
    slug = _slugify(clean)
    root = _projects_root()
    target = root / slug
    counter = 2
    while target.exists():
        target = root / f"{slug}-{counter}"
        counter += 1
    target.mkdir(parents=True)
    now = int(time.time())
    _write_meta(target, {"name": clean, "created": now})
    return {"id": target.name, "name": clean, "created": now, "updated": now}


def rename_project(slug: str, new_name: str) -> dict:
    folder = _projects_root() / _safe_slug(slug)
    if not folder.is_dir():
        raise FileNotFoundError("Немає такого проєкту")
    clean = " ".join((new_name or "").split())[:MAX_NAME]
    if not clean:
        raise ValueError("Потрібна назва")
    meta = _read_meta(folder)
    meta["name"] = clean
    meta.setdefault("created", int(folder.stat().st_ctime))
    _write_meta(folder, meta)
    return _as_dict(folder)


def delete_project(slug: str) -> dict:
    """Видалення = переїзд у .trash/ (як і решта робочої теки)."""
    folder = _projects_root() / _safe_slug(slug)
    if not folder.is_dir():
        raise FileNotFoundError("Немає такого проєкту")
    return workspace.delete_code(folder.name)


def exists(slug: str) -> bool:
    if not slug:
        return False
    try:
        return (_projects_root() / _safe_slug(slug)).is_dir()
    except ValueError:
        return False
