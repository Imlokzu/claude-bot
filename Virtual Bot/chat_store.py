"""
«Клод Бот» — історія чатів на диску.

Досі сесія жила лише в памʼяті процесу (з TTL годину), тому будь-який
перезапуск панелі чи перезавантаження сторінки стирали розмову — повернутись
до старого чату було нікуди. Тут кожна сесія — один JSON у user_data/chats/,
тож розмови переживають рестарт, а панель може показати їх список.

Формат файлу:
    {"id", "title", "created", "updated", "messages": [{"role","content","ts"}]}
"""

from __future__ import annotations

import json
import logging
import re
import time
from pathlib import Path

from brain_context import USER_DATA_DIR

log = logging.getLogger("virtual_bot.chat_store")

CHATS_DIR = USER_DATA_DIR / "chats"

# Скільки повідомлень тримаємо в одному чаті і скільки чатів узагалі
MAX_MESSAGES = 500
MAX_SESSIONS = 200
TITLE_LIMIT = 60

_SAFE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def is_valid_id(session_id: str) -> bool:
    """id сесії стає частиною шляху, тож перевіряємо його перед будь-чим."""
    return bool(_SAFE_ID_RE.match((session_id or "").strip()))


def _path(session_id: str) -> Path:
    """Шлях до файлу сесії. Ім'я перевіряємо суворо — це частина шляху."""
    sid = (session_id or "").strip()
    if not _SAFE_ID_RE.match(sid):
        raise ValueError("Некоректний id сесії")
    CHATS_DIR.mkdir(parents=True, exist_ok=True)
    return CHATS_DIR / f"{sid}.json"


def make_title(text: str) -> str:
    """Заголовок чату з першого повідомлення користувача."""
    clean = " ".join((text or "").split())
    if not clean:
        return "Без назви"
    return clean[:TITLE_LIMIT] + ("…" if len(clean) > TITLE_LIMIT else "")


def load(session_id: str) -> dict:
    """Сесія з диска; порожній каркас, якщо файлу ще немає."""
    try:
        path = _path(session_id)
    except ValueError:
        return {"id": "", "title": "", "created": 0, "updated": 0, "messages": []}
    if not path.is_file():
        return {"id": session_id, "title": "", "created": 0, "updated": 0, "messages": []}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        log.exception("Не вдалося прочитати чат %s", session_id)
        return {"id": session_id, "title": "", "created": 0, "updated": 0, "messages": []}
    data.setdefault("messages", [])
    data.setdefault("title", "")
    return data


def append(session_id: str, user: str, assistant: str, steps: list | None = None) -> None:
    """
    Дописує обмін до історії сесії (створює файл за потреби).

    `steps` — кроки інструментів цієї відповіді. Без них при поверненні до
    чату зникало все, що бот робив: лишався сам текст, а чим він шукав і що
    писав — ні.
    """
    try:
        path = _path(session_id)
    except ValueError:
        return
    now = int(time.time())
    data = load(session_id)
    if not data.get("created"):
        data["created"] = now
    if not data.get("title"):
        data["title"] = make_title(user)
    data["id"] = session_id
    data["updated"] = now
    data["messages"].append({"role": "user", "content": user, "ts": now})
    data["messages"].append({
        "role": "assistant",
        "content": assistant,
        "ts": now,
        **({"steps": steps[:20]} if steps else {}),
    })
    data["messages"] = data["messages"][-MAX_MESSAGES:]

    tmp = path.with_suffix(".tmp")
    try:
        # Пишемо через тимчасовий файл: обрив на середині не має лишати
        # понівечений JSON замість цілої розмови.
        tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        tmp.replace(path)
    except OSError:
        log.exception("Не вдалося зберегти чат %s", session_id)
        tmp.unlink(missing_ok=True)
        return
    _prune()


def history(session_id: str, limit: int) -> list[dict[str, str]]:
    """Останні повідомлення у форматі, який очікує brains.chat."""
    messages = load(session_id).get("messages", [])
    return [
        {"role": m.get("role", ""), "content": m.get("content", "")}
        for m in messages[-limit:]
        if m.get("role") in ("user", "assistant") and m.get("content")
    ]


def set_title(session_id: str, title: str) -> None:
    """Замінює заголовок чату (бот придумує його після першого обміну)."""
    clean = " ".join((title or "").split())[:TITLE_LIMIT]
    if not clean:
        return
    try:
        path = _path(session_id)
    except ValueError:
        return
    data = load(session_id)
    if not data.get("messages"):
        return
    data["title"] = clean
    tmp = path.with_suffix(".tmp")
    try:
        tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        tmp.replace(path)
    except OSError:
        log.exception("Не вдалося оновити назву чату %s", session_id)
        tmp.unlink(missing_ok=True)


def set_last_steps(session_id: str, steps: list) -> None:
    """
    Прикріплює кроки інструментів до ОСТАННЬОЇ відповіді бота.

    Панель шле їх після завершення стріму: там вони вже з позицією `at`
    у тексті, тож при поверненні до чату стрічка відновлюється так само —
    текст, під ним виклик, далі решта.
    """
    try:
        path = _path(session_id)
    except ValueError:
        return
    data = load(session_id)
    for message in reversed(data.get("messages") or []):
        if message.get("role") == "assistant":
            message["steps"] = (steps or [])[:20]
            break
    else:
        return
    tmp = path.with_suffix(".tmp")
    try:
        tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        tmp.replace(path)
    except OSError:
        log.exception("Не вдалося зберегти кроки чату %s", session_id)
        tmp.unlink(missing_ok=True)


def needs_title(session_id: str) -> bool:
    """Чи варто попросити бота придумати назву (лише після першого обміну)."""
    data = load(session_id)
    messages = data.get("messages") or []
    return len(messages) == 2 and not data.get("titled")


def mark_titled(session_id: str) -> None:
    """Позначає, що назву вже генерували — щоб не робити цього щоразу."""
    try:
        path = _path(session_id)
    except ValueError:
        return
    data = load(session_id)
    data["titled"] = True
    tmp = path.with_suffix(".tmp")
    try:
        tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        tmp.replace(path)
    except OSError:
        tmp.unlink(missing_ok=True)


def list_sessions(limit: int = 50) -> list[dict]:
    """Список чатів, найсвіжіші першими (без вмісту повідомлень)."""
    if not CHATS_DIR.is_dir():
        return []
    out: list[dict] = []
    for path in CHATS_DIR.glob("*.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        out.append({
            "id": data.get("id") or path.stem,
            "title": data.get("title") or "Без назви",
            "updated": int(data.get("updated") or 0),
            "count": len(data.get("messages") or []),
        })
    out.sort(key=lambda s: s["updated"], reverse=True)
    return out[:limit]


def delete(session_id: str) -> bool:
    try:
        path = _path(session_id)
    except ValueError:
        return False
    if path.is_file():
        path.unlink()
        return True
    return False


def _prune() -> None:
    """Тримаємо не більше MAX_SESSIONS чатів — найстаріші прибираємо."""
    sessions = list_sessions(limit=MAX_SESSIONS + 100)
    for stale in sessions[MAX_SESSIONS:]:
        try:
            delete(stale["id"])
        except OSError:
            log.exception("Не вдалося прибрати старий чат %s", stale["id"])
