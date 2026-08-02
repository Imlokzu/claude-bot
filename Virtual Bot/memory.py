"""
«Клод Бот» — Virtual Bot: проста файлова памʼять (brain/).

Нотатки — markdown-файли в brain/{people,topics,logs}/. Функції:
- список нотаток, читання, збереження (із захистом від path traversal);
- пошук топ-3 релевантних нотаток за ключовими словами запиту
  (підмішуються в системний промпт чату).
"""

from __future__ import annotations

import fcntl
import os
import re
import time
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path, PurePosixPath
from typing import BinaryIO, Iterator, Optional
from urllib.parse import quote, unquote, urlsplit

from app_config import BRAIN_DIR

# Максимум символів однієї нотатки, що йде в системний промпт
_NOTE_SNIPPET_LIMIT = 1500
_TOTAL_SNIPPET_LIMIT = 4500
_DURABLE_CATEGORIES = ("people", "life", "topics", "pets")
_MAX_LINKED_NOTES = 2
_MARKDOWN_LINK = re.compile(r"(!?)\[[^\]\r\n]*\]\(([^)\r\n]*)\)")
_MUTATION_LOCK_TIMEOUT_S = 10.0
_MUTATION_LOCK_POLL_S = 0.05
_NAVIGATION_NAME = "_navigation.md"
_RESERVED_COMPONENTS = {"logs", "recovery", "temp", "tmp", "service", "services", "lock"}
_RESERVED_FILENAMES = {_NAVIGATION_NAME, "_index.md"}
_UNSAFE_TEXT = re.compile(
    r"[\x00-\x1f\x7f-\x9f\u061c\u200e\u200f\u2028\u2029"
    r"\u202a-\u202e\u2060-\u2064\u2066-\u206f\ufff9-\ufffb]"
)
_HTML_TAG = re.compile(r"<[^>\r\n]*>")
_PLAIN_MARKDOWN_LINK = re.compile(r"!?(?:\[([^]\r\n]*)\])\([^)]*\)")
_PLAIN_REFERENCE_LINK = re.compile(r"!?(?:\[([^]\r\n]*)\])(?:\s*\[[^]\r\n]*\])")


def _is_reserved_component(component: str) -> bool:
    lowered = component.casefold()
    return lowered in _RESERVED_COMPONENTS or lowered.startswith(
        ("recovery-", "temp-", "tmp-", "service-", "lock-")
    )


class BrainPathError(ValueError):
    """Невалідний шлях нотатки (traversal, абсолютний шлях, симлінк назовні тощо)."""


class BrainWriteError(OSError):
    """A write and its rollback both failed, leaving an explicit error state."""


def _ensure_brain_dir() -> Path:
    root = BRAIN_DIR
    root.mkdir(parents=True, exist_ok=True)
    return root.resolve()


def try_acquire_brain_mutation_lock(root: Optional[Path] = None) -> Optional[BinaryIO]:
    """Try once to acquire the brain lock, returning immediately on contention."""
    lock_root = (root or BRAIN_DIR).resolve()
    lock_root.mkdir(parents=True, exist_ok=True)
    handle = open(lock_root / ".brain_mutation.lock", "a+b")
    try:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        handle.close()
        return None
    except Exception:
        handle.close()
        raise
    return handle


def acquire_brain_mutation_lock(
    root: Optional[Path] = None,
    timeout_s: float = _MUTATION_LOCK_TIMEOUT_S,
    poll_s: float = _MUTATION_LOCK_POLL_S,
) -> BinaryIO:
    """Acquire the brain lock within a bounded monotonic deadline."""
    if timeout_s < 0:
        raise ValueError("timeout_s must not be negative")
    if poll_s <= 0:
        raise ValueError("poll_s must be positive")
    deadline = time.monotonic() + timeout_s
    while True:
        handle = try_acquire_brain_mutation_lock(root)
        if handle is not None:
            return handle
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError(f"brain mutation lock unavailable after {timeout_s:.2f}s")
        time.sleep(min(poll_s, remaining))


def release_brain_mutation_lock(handle: BinaryIO) -> None:
    """Release a lock returned by :func:`acquire_brain_mutation_lock`."""
    try:
        fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
    finally:
        handle.close()


@contextmanager
def brain_mutation_lock(root: Optional[Path] = None) -> Iterator[None]:
    """Serialize note writes, log appends, and dream-cycle commits."""
    handle = acquire_brain_mutation_lock(root)
    try:
        yield
    finally:
        release_brain_mutation_lock(handle)


def resolve_note_path(rel_path: str, must_exist: bool = False) -> Path:
    """
    Перетворює відносний шлях ("people/imya.md") на абсолютний усередині brain/.

    Захист від path traversal:
    - тільки відносні шляхи; без "..", без порожніх/прихованих компонентів;
    - тільки *.md;
    - фінальний resolve() (розкриває симлінки) мусить лишитися всередині brain/.
    Інакше — BrainPathError (ендпоінти віддають 400).
    """
    root = _ensure_brain_dir()

    if not rel_path or "\\" in rel_path or _UNSAFE_TEXT.search(rel_path):
        raise BrainPathError("Порожній або невалідний шлях")

    pure = PurePosixPath(rel_path)
    if pure.is_absolute() or rel_path.startswith("~"):
        raise BrainPathError("Абсолютні шляхи заборонені")
    if any(part in ("..", ".", "") for part in pure.parts):
        raise BrainPathError("Компоненти '..' і '.' заборонені")
    if any(part.startswith(".") for part in pure.parts):
        raise BrainPathError("Приховані файли заборонені")
    if any(part.lower() in _RESERVED_FILENAMES for part in pure.parts):
        raise BrainPathError("Службові індекси захищено")
    if pure.suffix.lower() != ".md":
        raise BrainPathError("Дозволені лише .md файли")

    candidate = root / pure
    current = root
    for part in pure.parts:
        current = current / part
        if current.is_symlink():
            raise BrainPathError("Символічні посилання в шляху заборонені")
    resolved = candidate.resolve()  # розкриває симлінки
    if not resolved.is_relative_to(root):
        raise BrainPathError("Шлях виходить за межі brain/")
    # Симлінк усередині brain/, що вказує назовні, resolve() уже зловив би;
    # додатково перевіряємо, що жоден існуючий предок не є симлінком назовні.
    if must_exist and not resolved.is_file():
        raise FileNotFoundError(rel_path)
    return resolved


def _note_title(path: Path) -> str:
    """Заголовок нотатки: перший '# ...' рядок або назва файлу."""
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                stripped = line.strip()
                if stripped.startswith("#"):
                    return stripped.lstrip("#").strip() or path.stem
                if stripped:
                    break
    except OSError:
        pass
    return path.stem


def list_notes() -> list[dict[str, str]]:
    """Список усіх .md нотаток у brain/ (відносний шлях + заголовок)."""
    root = _ensure_brain_dir()
    notes: list[dict[str, str]] = []
    for path in sorted(root.rglob("*.md")):
        if not path.is_file():
            continue
        resolved = path.resolve()
        if not resolved.is_relative_to(root):  # симлінк назовні — ігноруємо
            continue
        rel = path.relative_to(root).as_posix()
        notes.append({"path": rel, "title": _note_title(path)})
    return notes


def read_note(rel_path: str) -> str:
    """Вміст нотатки за відносним шляхом (із валідацією)."""
    path = resolve_note_path(rel_path, must_exist=True)
    return path.read_text(encoding="utf-8", errors="replace")


def save_note(rel_path: str, content: str) -> None:
    """Зберігає нотатку (створює підпапки всередині brain/ за потреби)."""
    with brain_mutation_lock():
        path, pure = _validate_brain_path(rel_path, file=True)
        if pure.suffix.lower() != ".md":
            raise BrainPathError("Дозволені лише .md файли")
        missing_dirs: list[Path] = []
        parent = path.parent
        while not parent.exists():
            missing_dirs.append(parent)
            parent = parent.parent
        path.parent.mkdir(parents=True, exist_ok=True)
        previous = path.read_bytes() if path.exists() else None
        _atomic_write(path, content)
        try:
            _regenerate_brain_navigation_locked()
        except Exception as nav_error:
            try:
                if previous is None:
                    path.unlink(missing_ok=True)
                    for directory in missing_dirs:
                        try:
                            directory.rmdir()
                        except OSError:
                            pass
                else:
                    _atomic_write_bytes(path, previous)
            except Exception as restore_error:
                raise BrainWriteError(f"navigation failed and rollback failed: {restore_error}") from nav_error
            raise


def _validate_brain_path(relative_path: str, *, file: bool) -> tuple[Path, PurePosixPath]:
    root = _ensure_brain_dir()
    if not isinstance(relative_path, str) or not relative_path or "\\" in relative_path or _UNSAFE_TEXT.search(relative_path):
        raise BrainPathError("Порожній або невалідний шлях")
    pure = PurePosixPath(relative_path)
    if pure.is_absolute() or relative_path.startswith("~") or any(p in ("", ".", "..") for p in pure.parts):
        raise BrainPathError("Абсолютні шляхи та traversal заборонені")
    if any(p.startswith(".") for p in pure.parts):
        raise BrainPathError("Приховані компоненти заборонені")
    if any(_is_reserved_component(p) for p in pure.parts):
        raise BrainPathError("Службові компоненти заборонені")
    if any(p.lower() in _RESERVED_FILENAMES for p in pure.parts):
        raise BrainPathError("Службові індекси захищено")
    if file and pure.suffix.lower() not in {".md", ".txt"}:
        raise BrainPathError("Дозволені лише .md/.txt файли")
    candidate = root.joinpath(*pure.parts)
    current = root
    for part in pure.parts:
        current = current / part
        if current.is_symlink():
            raise BrainPathError("Символічні посилання заборонені")
    resolved = candidate.resolve()
    if not resolved.is_relative_to(root):
        raise BrainPathError("Шлях виходить за межі brain/")
    if file and candidate.exists() and candidate.is_dir():
        raise BrainPathError("Очікувався файл, знайдено папку")
    if not file and candidate.exists() and candidate.is_file():
        raise BrainPathError("Очікувалася папка, знайдено файл")
    return candidate, pure


def _atomic_write(path: Path, content: str) -> None:
    _atomic_write_bytes(path, content.encode("utf-8"))


def _atomic_write_bytes(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp-{os.getpid()}-{time.time_ns()}")
    try:
        with open(tmp, "wb") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
        try:
            fd = os.open(path.parent, os.O_RDONLY)
            os.fsync(fd)
            os.close(fd)
        except OSError:
            pass
    finally:
        try: tmp.unlink()
        except OSError: pass


def create_brain_directory(relative_path: str) -> str:
    """Create a directory below brain/ and refresh navigation."""
    with brain_mutation_lock():
        path, pure = _validate_brain_path(relative_path, file=False)
        existed = path.exists()
        missing: list[Path] = []
        parent = path
        while not parent.exists():
            missing.append(parent)
            parent = parent.parent
        path.mkdir(parents=True, exist_ok=True)
        try:
            _regenerate_brain_navigation_locked()
        except Exception:
            if not existed:
                for directory in missing:
                    try: directory.rmdir()
                    except OSError: pass
            raise
        return pure.as_posix()


def create_brain_file(relative_path: str, content: str, overwrite: bool = False) -> str:
    """Create a .md/.txt file below brain/ using an atomic durable write."""
    with brain_mutation_lock():
        path, pure = _validate_brain_path(relative_path, file=True)
        existed = path.exists()
        previous = path.read_bytes() if existed else None
        if existed and not overwrite:
            raise FileExistsError(relative_path)
        created_dirs: list[Path] = []
        try:
            parent = path.parent
            missing: list[Path] = []
            while not parent.exists():
                missing.append(parent); parent = parent.parent
            path.parent.mkdir(parents=True, exist_ok=True)
            created_dirs = missing
            _atomic_write(path, content)
            _regenerate_brain_navigation_locked()
        except Exception:
            if existed and previous is not None:
                try:
                    _atomic_write_bytes(path, previous)
                except Exception as restore_error:
                    raise BrainWriteError(f"navigation failed and rollback failed: {restore_error}")
            else:
                try: path.unlink()
                except OSError: pass
                for directory in created_dirs:
                    try: directory.rmdir()
                    except OSError: pass
            raise
        return pure.as_posix()


def _description(path: Path) -> str:
    try:
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            text = re.sub(r"^\s{0,3}#{1,6}\s*", "", line).strip()
            text = re.sub(r"[`*_>~-]", "", text).strip()
            if text:
                return text[:160]
    except OSError:
        pass
    return path.stem


def _sanitize_navigation_label(text: str) -> str:
    """Return readable text that cannot introduce Markdown or HTML constructs."""
    text = _UNSAFE_TEXT.sub("", text)
    text = _HTML_TAG.sub("", text)
    text = _PLAIN_MARKDOWN_LINK.sub(r"\1", text)
    text = _PLAIN_REFERENCE_LINK.sub(r"\1", text)
    text = re.sub(r"[\[\]()<>`*_{}~]", "", text)
    return " ".join(text.split())


def _regenerate_brain_navigation_locked() -> str:
    root = _ensure_brain_dir()
    lines = ["# Brain Navigation", "", "Generated index of brain files.", ""]

    def walk(directory: Path, depth: int) -> None:
        try: entries = sorted(directory.iterdir(), key=lambda p: (not p.is_dir(), p.name.casefold(), p.name))
        except OSError: return
        for entry in entries:
            if entry.name.startswith(".") or entry.name in {_NAVIGATION_NAME, "_index.md"} or entry.is_symlink() or ".tmp-" in entry.name:
                continue
            if entry.is_dir():
                if _is_reserved_component(entry.name):
                    continue
                lines.append("  " * depth + f"- **{_sanitize_navigation_label(entry.name)}/**")
                walk(entry, depth + 1)
            elif entry.suffix.lower() in {".md", ".txt"}:
                rel = entry.relative_to(root).as_posix()
                link = quote(rel, safe="/._-~")
                lines.append(
                    "  " * depth
                    + f"- [{_sanitize_navigation_label(entry.name)}]({link}) — "
                    + _sanitize_navigation_label(_description(entry))
                )
    walk(root, 0)
    _atomic_write(root / _NAVIGATION_NAME, "\n".join(lines) + "\n")
    return "\n".join(lines) + "\n"


def regenerate_brain_navigation() -> str:
    """Rebuild brain/_navigation.md deterministically."""
    with brain_mutation_lock():
        return _regenerate_brain_navigation_locked()


def _one_line(text: str) -> str:
    """Стискає багаторядковий текст в один рядок для журналу."""
    return " ".join(text.split())


def append_chat_log(user_text: str, reply_text: str, emotion: str) -> str:
    """
    Автожурнал розмов: ДОПИСУЄ (append, не перезаписує) обмін у
    brain/logs/YYYY-MM-DD.md (дата — системна). Якщо файла ще нема,
    створює його з українським заголовком. Шлях проходить ту саму
    валідацію, що й нотатки (resolve_note_path). Повертає відносний шлях.
    """
    with brain_mutation_lock():
        now = datetime.now()
        rel_path = f"logs/{now:%Y-%m-%d}.md"
        path = resolve_note_path(rel_path)
        path.parent.mkdir(parents=True, exist_ok=True)

        stamp = now.strftime("%H:%M")
        chunk = ""
        if not path.exists():
            chunk += f"# Журнал розмов — {now:%Y-%m-%d}\n\n"
        elif path.stat().st_size > 0:
            # Відділяємо запис порожнім рядком, якщо файл не закінчується ним.
            with open(path, "rb") as f:
                f.seek(max(0, path.stat().st_size - 2))
                tail = f.read()
            if not tail.endswith(b"\n\n"):
                chunk += "\n" if tail.endswith(b"\n") else "\n\n"
        chunk += (
            f"**{stamp}** Ви: {_one_line(user_text)}\n"
            f"**{stamp}** Бот ({emotion}): {_one_line(reply_text)}\n\n"
        )
        with open(path, "a", encoding="utf-8") as f:
            f.write(chunk)
    return rel_path


def _tokenize(text: str) -> list[str]:
    """Ключові слова: кирилиця/латиниця/цифри, довжина >= 3."""
    words = re.findall(r"[а-щьюяіїєґa-z0-9']+", text.lower())
    return [w for w in words if len(w) >= 3]


_USER_PROFILE_PATH = "people/user.md"


def load_user_profile() -> str:
    """Повертає вміст brain/people/user.md або порожній рядок."""
    try:
        return read_note(_USER_PROFILE_PATH)
    except (BrainPathError, FileNotFoundError, OSError):
        return ""


def append_user_profile(addition: str) -> None:
    """Дописує нові факти до brain/people/user.md (створює файл, якщо немає)."""
    addition = addition.strip()
    if not addition:
        return
    with brain_mutation_lock():
        current = ""
        try:
            current = read_note(_USER_PROFILE_PATH)
        except (BrainPathError, FileNotFoundError, OSError):
            pass
        lines = [ln for ln in current.splitlines() if ln.strip()]
        if not lines or not lines[0].strip().startswith("#"):
            current = "# Профіль користувача\n\n" + current
        if current and not current.endswith("\n"):
            current += "\n"
        if current and not current.endswith("\n\n"):
            current += "\n"
        current += f"- {addition}\n"
        path = resolve_note_path(_USER_PROFILE_PATH)
        missing_dirs: list[Path] = []
        parent = path.parent
        while not parent.exists():
            missing_dirs.append(parent)
            parent = parent.parent
        path.parent.mkdir(parents=True, exist_ok=True)
        previous = path.read_bytes() if path.exists() else None
        _atomic_write(path, current)
        try:
            _regenerate_brain_navigation_locked()
        except Exception as nav_error:
            try:
                if previous is None:
                    path.unlink(missing_ok=True)
                    for directory in missing_dirs:
                        try:
                            directory.rmdir()
                        except OSError:
                            pass
                else:
                    _atomic_write_bytes(path, previous)
            except Exception as restore_error:
                raise BrainWriteError(f"navigation failed and rollback failed: {restore_error}") from nav_error
            raise


def _durable_note_paths(root: Path) -> list[Path]:
    paths: list[Path] = []
    for category in _DURABLE_CATEGORIES:
        directory = root / category
        if directory.is_symlink():
            continue
        if not directory.is_dir():
            continue
        paths.extend(
            path
            for path in directory.glob("*.md")
            if path.name != "_index.md"
            and path.is_file()
            and not path.is_symlink()
            and path.resolve().is_relative_to(root)
        )
    return sorted(paths, key=lambda path: path.relative_to(root).as_posix())


def _linked_note_path(root: Path, source: Path, raw_target: str) -> Optional[Path]:
    if not raw_target or "\\" in raw_target or "\x00" in raw_target:
        return None
    target = unquote(raw_target)
    if (
        not target
        or "\\" in target
        or "\x00" in target
        or "?" in raw_target
        or "#" in raw_target
        or "?" in target
        or "#" in target
        or target.startswith(("/", "~"))
        or urlsplit(target).scheme
    ):
        return None
    resolved = (source.parent / target).resolve()
    if not resolved.is_relative_to(root):
        return None
    relative = resolved.relative_to(root)
    if (
        len(relative.parts) != 2
        or relative.parts[0] not in _DURABLE_CATEGORIES
        or relative.name == "_index.md"
        or relative.suffix.lower() != ".md"
        or resolved == source.resolve()
        or not resolved.is_file()
        or resolved.is_symlink()
    ):
        return None
    return resolved


def find_relevant_notes(query: str, top_n: int = 3) -> list[dict[str, str]]:
    """
    Топ-N нотаток за збігом ключових слів запиту з текстом нотатки.
    Повертає [{"path", "title", "snippet"}] тільки з ненульовим скором.
    """
    tokens = set(_tokenize(query))
    if not tokens:
        return []

    root = _ensure_brain_dir()
    scored: list[tuple[int, str, str, str, Path]] = []
    for path in _durable_note_paths(root):
        try:
            content = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        haystack = (path.stem + " " + content).lower()
        score = sum(haystack.count(token) for token in tokens)
        if score > 0:
            rel = path.relative_to(root).as_posix()
            scored.append((score, rel, _note_title(path), content, path))

    scored.sort(key=lambda item: (-item[0], item[1]))
    primary = scored[: max(0, top_n)]
    selected = list(primary)
    selected_paths = {item[4].resolve() for item in primary}
    linked_count = 0
    for _score, _rel, _title, content, source in primary:
        for image_marker, raw_target in _MARKDOWN_LINK.findall(content):
            if image_marker:
                continue
            target = _linked_note_path(root, source, raw_target)
            if target is None or target.resolve() in selected_paths:
                continue
            try:
                target_content = target.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            rel = target.relative_to(root).as_posix()
            selected.append((0, rel, _note_title(target), target_content, target))
            selected_paths.add(target.resolve())
            linked_count += 1
            if linked_count == _MAX_LINKED_NOTES:
                break
        if linked_count == _MAX_LINKED_NOTES:
            break

    result: list[dict[str, str]] = []
    remaining = _TOTAL_SNIPPET_LIMIT
    for _score, rel, title, content, _path in selected:
        if remaining <= 0:
            break
        snippet = content[: min(_NOTE_SNIPPET_LIMIT, remaining)]
        result.append({"path": rel, "title": title, "snippet": snippet})
        remaining -= len(snippet)
    return result
