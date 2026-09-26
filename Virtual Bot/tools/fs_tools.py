"""
Тули перегляду ЛОКАЛЬНИХ ПРОЄКТІВ поза робочою текою бота.

На відміну від workspace/ (замкнена пісочниця бота, будь-який вихід за корінь
відсікається в workspace._resolve), тут бот читає довільний шлях на диску
власника — весь диск у принципі. Тому дві запобіжники:

1. Дозвіл питається так само, як і будь-яке інше уточнення в цьому боті —
   карткою ask_question ("Дозволити доступ до <шлях>?", ['Дозволити', 'Ні']).
   Перший виклик для незнайомої теки замість вмісту повертає needs_approval,
   і сам мозок мусить спитати; відповідь користувача ("Дозволити") приходить
   звичайним повідомленням, і мозок кличе fs_approve — після цього шлях (і всі
   підтеки під ним) дозволені назавжди, повторно не питаємо.
2. Список DENY_PREFIXES — теки з ключами й обліковими даними, які НЕ можна
   дозволити навіть відповіддю "Дозволити": ризик, що LLM їх десь процитує чи
   передасть далі, переважує будь-яку користь від перегляду.

Лише читання: списку й вмісту файлу. Ні запису, ні видалення — для цього
лишається власна тека бота (workspace_write і т.д.).
"""

from __future__ import annotations

import json
import logging
import urllib.parse
from pathlib import Path

log = logging.getLogger("virtual_bot.tools.fs")

BASE_DIR = Path(__file__).resolve().parent.parent
ACCESS_PATH = BASE_DIR / "fs_access.json"
HOME = Path.home()

MAX_READ_BYTES = 1_000_000
MAX_ENTRIES = 1000

# Ключі, токени, keychain — заборонено навіть з явним дозволом користувача.
# Резолв симлінків — у _under_any(), яка порівнює ці префікси з викликом.
DENY_PREFIXES = [
    HOME / ".ssh",
    HOME / ".aws",
    HOME / ".gnupg",
    HOME / ".kube",
    HOME / ".config" / "gcloud",
    HOME / ".docker",
    HOME / "Library" / "Keychains",
    HOME / "Library" / "Cookies",
    HOME / "Library" / "Application Support" / "Google" / "Chrome",
    BASE_DIR / ".env",
]


def _load_approved() -> list[str]:
    try:
        raw = json.loads(ACCESS_PATH.read_text(encoding="utf-8"))
        if isinstance(raw, list):
            return [str(p) for p in raw]
    except (OSError, ValueError):
        pass
    return []


def _save_approved(paths: list[str]) -> None:
    tmp = ACCESS_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(sorted(set(paths)), ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(ACCESS_PATH)


def _under_any(path: Path, roots: list[Path]) -> bool:
    """path.is_relative_to() compares path components, not real files — every
    root gets resolve()'d too, or a symlinked prefix (macOS /var, /tmp, ...)
    could silently fail to match an already-resolved `path`."""
    resolved_roots = [r.resolve() for r in roots]
    return any(path == r or path.is_relative_to(r) for r in resolved_roots)


def _is_denied(path: Path) -> bool:
    return _under_any(path, DENY_PREFIXES)


def _is_approved(path: Path) -> bool:
    return _under_any(path, [Path(p) for p in _load_approved()])


def _resolve(raw: str) -> Path:
    """Довільний шлях (у т.ч. file://, ~) → абсолютний, реально існуючий."""
    text = (raw or "").strip()
    if not text:
        raise ValueError("Потрібен шлях")
    if text.startswith("file://"):
        text = urllib.parse.unquote(urllib.parse.urlparse(text).path)
    path = Path(text).expanduser()
    if not path.is_absolute():
        raise ValueError("Потрібен абсолютний шлях, напр. /Users/.../project")
    resolved = path.resolve()
    if not resolved.exists():
        raise FileNotFoundError(f"Немає такого шляху: {raw}")
    return resolved


_APPROVAL_NOTE = (
    "Доступ до цієї теки ще не дозволено. Спитай користувача карткою ask_question: "
    "питання «Дозволити боту доступ до {path}?», варіанти ['Дозволити', 'Ні']. "
    "Якщо відповість «Дозволити» — поклич fs_approve із цим самим шляхом, тоді повтори виклик."
)


def _entry(path: Path) -> dict:
    stat = path.stat()
    is_dir = path.is_dir()
    return {
        "name": path.name,
        "path": str(path),
        "type": "dir" if is_dir else "file",
        "size": 0 if is_dir else stat.st_size,
        "mtime": int(stat.st_mtime),
    }


async def fs_list(path: str) -> dict:
    try:
        target = _resolve(path)
    except (ValueError, OSError) as exc:
        return {"error": str(exc)}
    if _is_denied(target):
        return {"error": "Ця тека — у списку заборонених (ключі/облікові дані), доступ не дається ні за яких умов."}
    if not _is_approved(target):
        return {"needs_approval": True, "path": str(target), "note": _APPROVAL_NOTE.format(path=target)}
    if not target.is_dir():
        return {"error": f"Це не тека: {target}"}
    entries = []
    for child in sorted(target.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
        try:
            entries.append(_entry(child))
        except OSError:
            continue
        if len(entries) >= MAX_ENTRIES:
            break
    return {"path": str(target), "entries": entries}


async def fs_read(path: str) -> dict:
    try:
        target = _resolve(path)
    except (ValueError, OSError) as exc:
        return {"error": str(exc)}
    if _is_denied(target):
        return {"error": "Ця тека — у списку заборонених (ключі/облікові дані), доступ не дається ні за яких умов."}
    if not _is_approved(target):
        return {"needs_approval": True, "path": str(target), "note": _APPROVAL_NOTE.format(path=target)}
    if not target.is_file():
        return {"error": f"Це не файл: {target}"}
    size = target.stat().st_size
    if size > MAX_READ_BYTES:
        return {"path": str(target), "size": size, "binary": False, "too_large": True, "content": ""}
    raw = target.read_bytes()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return {"path": str(target), "size": size, "binary": True, "content": ""}
    return {"path": str(target), "size": size, "binary": False, "content": text}


async def fs_approve(path: str) -> dict:
    try:
        target = _resolve(path)
    except (ValueError, OSError) as exc:
        return {"error": str(exc)}
    if _is_denied(target):
        return {"error": "Цю теку дозволити не можна — вона у списку заборонених."}
    approved = _load_approved()
    approved.append(str(target))
    _save_approved(approved)
    log.info("Дозволено доступ поза текою бота: %s", target)
    return {"ok": True, "approved": str(target)}


SCHEMAS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "fs_list",
            "description": (
                "Показати вміст ДОВІЛЬНОЇ теки на диску власника (поза робочою текою бота) — "
                "напр. реальний проєкт із file:// посилання. Перший виклик для нової теки "
                "поверне needs_approval — спитай дозволу карткою ask_question і повтори."
            ),
            "parameters": {
                "type": "object",
                "properties": {"path": {"type": "string", "description": "Абсолютний шлях, напр. '/Users/hhh/projects/foo'."}},
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "fs_read",
            "description": "Прочитати текстовий файл за довільним абсолютним шляхом на диску (те саме правило дозволу, що й fs_list).",
            "parameters": {
                "type": "object",
                "properties": {"path": {"type": "string", "description": "Абсолютний шлях до файлу."}},
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "fs_approve",
            "description": (
                "Позначити шлях (і всі підтеки під ним) дозволеним для fs_list/fs_read НАЗАВЖДИ. "
                "Клич лише одразу після того, як користувач відповів «Дозволити» на картку ask_question — "
                "не вгадуй за нього."
            ),
            "parameters": {
                "type": "object",
                "properties": {"path": {"type": "string"}},
                "required": ["path"],
            },
        },
    },
]

HANDLERS = {
    "fs_list": fs_list,
    "fs_read": fs_read,
    "fs_approve": fs_approve,
}
