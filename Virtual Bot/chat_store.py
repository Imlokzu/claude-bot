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

from contextlib import contextmanager
from contextvars import ContextVar
from typing import Iterator

import profile_store
from brain_context import USER_DATA_DIR, get_active_clerk_user, clerk_user_dir_name

log = logging.getLogger("virtual_bot.chat_store")

CHATS_DIR = USER_DATA_DIR / "chats"

# Простори розмов. Чат і кодинг — РІЗНІ харнеси з різною історією, різними
# назвами й різним життєвим циклом, тому й лежать вони в різних теках, а не
# перемішані з ознакою в JSON: список, видалення, обрізання й пошук працюють
# у своєму просторі без жодної фільтрації, і не можуть випадково зачепити чужий.
KIND_CHAT = "chat"
KIND_CODE = "code"
_KIND_DIRS = {KIND_CHAT: "chats", KIND_CODE: "code-chats"}

_kind_ctx: ContextVar[str] = ContextVar("chat_kind", default=KIND_CHAT)


def active_kind() -> str:
    return _kind_ctx.get()


@contextmanager
def set_kind(kind: str) -> Iterator[None]:
    """Перемикає простір розмов на час запиту (ContextVar, не глобалка)."""
    token = _kind_ctx.set(kind if kind in _KIND_DIRS else KIND_CHAT)
    try:
        yield
    finally:
        _kind_ctx.reset(token)


def _active_chats_dir() -> Path:
    sub = _KIND_DIRS.get(_kind_ctx.get(), "chats")
    uid = get_active_clerk_user()
    if uid:
        return USER_DATA_DIR / clerk_user_dir_name(uid) / sub
    # Тести підмінюють CHATS_DIR — поважаємо це, але кодингові розмови все
    # одно тримаємо збоку, щоб вони не потрапили у список звичайних чатів.
    return CHATS_DIR if sub == "chats" else CHATS_DIR.parent / sub

# Скільки повідомлень тримаємо в одному чаті і скільки чатів узагалі
MAX_MESSAGES = 500
MAX_SESSIONS = 200
TITLE_LIMIT = 60
PARTICIPANT_NAME_LIMIT = 48
# Лапки рамки «Учасник «X» каже:» — в імені їм не місце (див.
# normalize_participant_name). Переводи рядка сюди не входять: вони мають
# стати пробілом, а не склеїти сусідні слова.
_NAME_FORBIDDEN = frozenset('«»')

_SAFE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def is_valid_id(session_id: str) -> bool:
    """id сесії стає частиною шляху, тож перевіряємо його перед будь-чим."""
    return bool(_SAFE_ID_RE.match((session_id or "").strip()))


def _path(session_id: str) -> Path:
    """Шлях до файлу сесії. Ім'я перевіряємо суворо — це частина шляху."""
    sid = (session_id or "").strip()
    if not _SAFE_ID_RE.match(sid):
        raise ValueError("Некоректний id сесії")
    d = _active_chats_dir()
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{sid}.json"


def make_title(text: str) -> str:
    """Заголовок чату з першого повідомлення користувача."""
    clean = " ".join((text or "").split())
    if not clean:
        return "Без назви"
    return clean[:TITLE_LIMIT] + ("…" if len(clean) > TITLE_LIMIT else "")


def normalize_participant_name(name: str) -> str:
    """
    Імʼя учасника для UI й контексту агента — один рядок без зайвих пробілів.

    Імʼя потрапляє в текст, який читає модель, усередині рамки
    «Учасник «X» каже:». Екранувати там нема куди — це звичайна проза, не
    розмітка, — тому символи самої рамки й переводи рядка з імені просто
    прибираємо: інакше імʼя «Оля» каже: ...» підробляє чужу репліку.
    """
    clean = "".join(
        ch for ch in str(name or "")
        if ch not in _NAME_FORBIDDEN and (ch.isspace() or ch.isprintable())
    )
    return " ".join(clean.split())[:PARTICIPANT_NAME_LIMIT]


def _name_key(name: str) -> str:
    """Ключ порівняння імен: без регістру й пробілів («клодбот» == «Клод Бот»)."""
    return "".join(str(name or "").split()).casefold()


def is_reserved_participant_name(name: str) -> bool:
    """Імʼя бота людині не належить: під ним репліки читалися б як його власні."""
    key = _name_key(name)
    if not key:
        return False
    try:
        bot_name = profile_store.load().get("name", "")
    except Exception:  # noqa: BLE001 — профіль не має права ламати чат
        log.exception("Не вдалося прочитати профіль для перевірки імені")
        bot_name = ""
    return key in {_name_key(bot_name), _name_key("Клод Бот"), "бот", "bot"}


def _ensure_participant(data: dict, name: str, now: int) -> tuple[dict | None, bool]:
    """Повертає учасника та чи це справді нове приєднання."""
    clean = normalize_participant_name(name)
    if not clean or is_reserved_participant_name(clean):
        return None, False
    participants = data.setdefault("participants", [])
    for participant in participants:
        if participant.get("name") == clean and participant.get("kind") == "human":
            return participant, False
    participant = {"name": clean, "kind": "human", "joined": now}
    participants.append(participant)
    data.setdefault("events", []).append({
        "type": "participant_joined",
        "name": clean,
        "kind": "human",
        "ts": now,
    })
    return participant, True


def load(session_id: str) -> dict:
    """Сесія з диска; порожній каркас, якщо файлу ще немає."""
    try:
        path = _path(session_id)
    except ValueError:
        return {
            "id": "", "title": "", "created": 0, "updated": 0,
            "messages": [], "participants": [], "events": [],
        }
    if not path.is_file():
        return {
            "id": session_id, "title": "", "created": 0, "updated": 0,
            "messages": [], "participants": [], "events": [],
        }
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        log.exception("Не вдалося прочитати чат %s", session_id)
        return {
            "id": session_id, "title": "", "created": 0, "updated": 0,
            "messages": [], "participants": [], "events": [],
        }
    data.setdefault("messages", [])
    data.setdefault("title", "")
    data.setdefault("participants", [])
    data.setdefault("events", [])
    return data


def add_participant(session_id: str, name: str) -> tuple[dict | None, bool]:
    """Приєднує людину до сесії та зберігає подію для timeline."""
    try:
        path = _path(session_id)
    except ValueError:
        return None, False
    now = int(time.time())
    data = load(session_id)
    participant, joined = _ensure_participant(data, name, now)
    if participant is None:
        return None, False
    if not data.get("created"):
        data["created"] = now
    data["id"] = session_id
    data["updated"] = now
    if not joined:
        return participant, False
    tmp = path.with_suffix(".tmp")
    try:
        tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        tmp.replace(path)
    except OSError:
        log.exception("Не вдалося додати учасника до чату %s", session_id)
        tmp.unlink(missing_ok=True)
        return None, False
    _prune()
    return participant, True


def remove_participant(session_id: str, name: str) -> bool:
    """
    Прибирає людину зі списку присутніх і лишає подію в timeline.

    Вихід — явна дія людини, а не наслідок закритої вкладки: `beforeunload`
    спрацьовує не завжди й бреше при перезавантаженні. Тому False тут —
    нормальна відповідь («вже не в списку»), а не помилка: подвійний клік по
    «Вийти» не має малювати збій.
    """
    try:
        path = _path(session_id)
    except ValueError:
        return False
    clean = normalize_participant_name(name)
    if not clean or not path.is_file():
        return False
    data = load(session_id)
    participants = data.get("participants", [])
    rest = [
        p for p in participants
        if not (p.get("name") == clean and p.get("kind") == "human")
    ]
    if len(rest) == len(participants):
        return False
    now = int(time.time())
    data["participants"] = rest
    data.setdefault("events", []).append({
        "type": "participant_left",
        "name": clean,
        "kind": "human",
        "ts": now,
    })
    data["id"] = session_id
    data["updated"] = now
    tmp = path.with_suffix(".tmp")
    try:
        tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        tmp.replace(path)
    except OSError:
        log.exception("Не вдалося прибрати учасника з чату %s", session_id)
        tmp.unlink(missing_ok=True)
        return False
    return True


def append(
    session_id: str,
    user: str,
    assistant: str,
    steps: list | None = None,
    attachments: list[dict] | None = None,
    participant: str = "",
) -> None:
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
    human, _joined = _ensure_participant(data, participant, now)
    data["messages"].append({
        "role": "user",
        "content": user,
        "ts": now,
        **({"attachments": attachments[:8]} if attachments else {}),
        **({"participant": human["name"]} if human else {}),
    })
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
    history: list[dict[str, str]] = []
    for message in messages[-limit:]:
        role = message.get("role", "")
        content = message.get("content", "")
        if role not in ("user", "assistant") or not content:
            continue
        participant = normalize_participant_name(message.get("participant", ""))
        if role == "user" and participant:
            content = f"Учасник «{participant}» каже:\n{content}"
        history.append({"role": role, "content": content})
    return history


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


def list_sessions(limit: int = 50, include_empty: bool = False) -> list[dict]:
    """
    Список чатів, найсвіжіші першими (без вмісту повідомлень).

    Файл сесії зʼявляється не лише від першої репліки: його створює і
    «приєднатися», і обірваний запит, у якому мозок упав уже після запису
    учасника. Такі порожні сесії показувати нема чого — у списку вони
    виглядають як «Без назви · 0».

    Але ховати їх геть теж не можна: `_prune` прибирає старі чати саме за цим
    списком, і невидимий файл ніколи не потрапив би під прибирання й лежав би
    вічно. Тому фільтр — лише для показу, а `include_empty=True` дає повний
    перелік того, що реально є на диску.
    """
    d = _active_chats_dir()
    if not d.is_dir():
        return []
    out: list[dict] = []
    for path in d.glob("*.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not include_empty and not (data.get("messages") or data.get("title")):
            continue
        out.append({
            "id": data.get("id") or path.stem,
            "title": data.get("title") or "Без назви",
            "updated": int(data.get("updated") or 0),
            "count": len(data.get("messages") or []),
            "pinned": bool(data.get("pinned")),
            "project": data.get("project") or "",
        })
    # Закріплені чати завжди зверху; всередині групи — найсвіжіші першими.
    out.sort(key=lambda s: (not s["pinned"], -s["updated"]))
    return out[:limit]


def set_pinned(session_id: str, pinned: bool) -> bool:
    """Закріплює/відкріплює чат; стан живе у JSON сесії після рестарту."""
    try:
        path = _path(session_id)
    except ValueError:
        return False
    data = load(session_id)
    if not data.get("messages"):
        return False
    data["pinned"] = bool(pinned)
    tmp = path.with_suffix(".tmp")
    try:
        tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        tmp.replace(path)
        return True
    except OSError:
        log.exception("Не вдалося змінити закріплення чату %s", session_id)
        tmp.unlink(missing_ok=True)
        return False


def set_project(session_id: str, project: str) -> bool:
    """Прив'язує чат до проєкту (slug) або знімає прив'язку (порожній рядок)."""
    try:
        path = _path(session_id)
    except ValueError:
        return False
    data = load(session_id)
    if not data.get("messages"):
        return False
    clean = (project or "").strip()
    if clean:
        data["project"] = clean
    else:
        data.pop("project", None)
    tmp = path.with_suffix(".tmp")
    try:
        tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        tmp.replace(path)
        return True
    except OSError:
        log.exception("Не вдалося привʼязати чат %s до проєкту", session_id)
        tmp.unlink(missing_ok=True)
        return False


def clear_project(project: str) -> None:
    """Знімає прив'язку до проєкту з усіх чатів (проєкт видалили)."""
    d = _active_chats_dir()
    if not d.is_dir():
        return
    for path in d.glob("*.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if data.get("project") != project:
            continue
        data.pop("project", None)
        tmp = path.with_suffix(".tmp")
        try:
            tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
            tmp.replace(path)
        except OSError:
            log.exception("Не вдалося зняти привʼязку до проєкту у %s", path.name)
            tmp.unlink(missing_ok=True)


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
    sessions = list_sessions(limit=MAX_SESSIONS + 100, include_empty=True)
    for stale in sessions[MAX_SESSIONS:]:
        try:
            delete(stale["id"])
        except OSError:
            log.exception("Не вдалося прибрати старий чат %s", stale["id"])
