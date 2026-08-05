"""
«Клод Бот» — Virtual Bot: ізоляція памʼяті за сесією/користувачем.

Кожен session_id отримує власний порожній brain із мінімальним набором
каталогів у git-ignored user_data/<sha256>/brain. SHA-256 мапінг
гарантує, що шкідливі/довгі session_id не можуть вийти за межі runtime.
Контекст поточного brain передається через ContextVar, а не глобальну
змінну: запити різних користувачів не перемішуються.
"""

from __future__ import annotations

import errno
import hashlib
import os
import re
import shutil
import tempfile
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path
from typing import Iterator

from app_config import BASE_DIR, BRAIN_DIR

# Git-ignored корінь даних розробницьких користувачів.
USER_DATA_DIR = BASE_DIR / "user_data"
# Сумісний псевдонім: зовнішній код історично імпортував цю назву.
BRAIN_RUNTIME_DIR = USER_DATA_DIR

# namespace used when no session_id is provided
DEFAULT_BRAIN_ID = "__default__"

# Безпечний seed містить лише структуру, ніколи не файли зі спільного brain/.
# Отже приватні профілі, нотатки й журнали наявного власника не можуть
# потрапити до щойно створеного користувача.
_SEED_DIRECTORIES = ("people", "topics", "logs")

_brain_root_ctx: ContextVar[Path | None] = ContextVar("brain_root", default=None)

_DIGEST_ID_RE = re.compile(r"^[0-9a-f]{64}$")


def _sha_dir_name(session_id: str) -> str:
    """Deterministic, collision-resistant directory name for a session_id."""
    return hashlib.sha256(session_id.encode("utf-8")).hexdigest()


def _user_brain_root(session_id: str) -> Path:
    """Runtime directory path for a given session_id (does not create it)."""
    base = BRAIN_RUNTIME_DIR.resolve()
    user_dir = base / _sha_dir_name(session_id)
    brain = user_dir / "brain"
    if user_dir.is_symlink() or brain.is_symlink():
        raise OSError("Шлях user brain не може бути символічним посиланням")
    return brain


def resolve_user_brain_root(brain_id: str) -> Path:
    """Validate and resolve an enumerated per-user brain immediately before use.

    Background jobs enumerate digest directory names and then use them later;
    this second validation prevents a symlink replacement from redirecting a
    job outside ``BRAIN_RUNTIME_DIR``.
    """
    if not isinstance(brain_id, str) or not _DIGEST_ID_RE.fullmatch(brain_id):
        raise ValueError("invalid user brain digest")

    runtime = BRAIN_RUNTIME_DIR.resolve()
    user_dir = BRAIN_RUNTIME_DIR / brain_id
    brain = user_dir / "brain"
    if user_dir.is_symlink() or not user_dir.is_dir():
        raise OSError("user brain directory is invalid")
    if brain.is_symlink() or not brain.is_dir():
        raise OSError("user brain root is invalid")

    resolved_user = user_dir.resolve()
    resolved_brain = brain.resolve()
    if not resolved_user.is_relative_to(runtime) or not resolved_brain.is_relative_to(runtime):
        raise OSError("user brain path escapes runtime")
    if resolved_user == runtime or resolved_brain == runtime:
        raise OSError("user brain path is invalid")
    return resolved_brain


def _seed_brain_atomic(dst: Path) -> None:
    """Atomically create an empty user brain. No-op if dst already exists."""
    if dst.exists():
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix=".brain-init-", dir=str(dst.parent)))
    try:
        for directory in _SEED_DIRECTORIES:
            (tmp / directory).mkdir()
        try:
            os.replace(tmp, dst)
        except OSError as exc:
            # Інший потік/процес міг атомарно опублікувати той самий brain.
            # У такому разі його повну копію приймаємо як результат; інші
            # помилки (права, диск, неочікуваний тип) не приховуємо.
            if exc.errno not in {errno.EEXIST, errno.ENOTEMPTY} or not dst.is_dir():
                raise
    except Exception:
        shutil.rmtree(tmp, ignore_errors=True)
        raise
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _normalized_session_id(session_id: str | None) -> str:
    """Treat empty/None as the default namespace."""
    if session_id is None:
        return DEFAULT_BRAIN_ID
    sid = session_id.strip()
    return sid if sid else DEFAULT_BRAIN_ID


def init_user_brain(session_id: str | None = None) -> Path:
    """Return the runtime brain root for session_id, creating it atomically if needed."""
    sid = _normalized_session_id(session_id)
    root = _user_brain_root(sid)
    _seed_brain_atomic(root)
    return root


def clear_user_brain(session_id: str | None = None) -> None:
    """Remove a user brain directory (useful in tests)."""
    root = _user_brain_root(_normalized_session_id(session_id))
    if root.exists():
        shutil.rmtree(root)


def list_user_brain_ids() -> list[str]:
    """List all initialized user brain directory names (hex digests)."""
    if not BRAIN_RUNTIME_DIR.exists():
        return []
    return sorted(
        d.name for d in BRAIN_RUNTIME_DIR.iterdir()
        if d.is_dir()
        and not d.is_symlink()
        and len(d.name) == 64
        and all(char in "0123456789abcdef" for char in d.name)
        and (d / "brain").is_dir()
        and not (d / "brain").is_symlink()
    )


def get_active_brain_root() -> Path:
    """Current brain root from ContextVar, falling back to the protected template."""
    active = _brain_root_ctx.get()
    if active is not None:
        return active
    return BRAIN_DIR


@contextmanager
def set_brain_root(root: Path) -> Iterator[None]:
    """Set the active brain root for the current async/sync context."""
    token = _brain_root_ctx.set(root)
    try:
        yield
    finally:
        _brain_root_ctx.reset(token)
