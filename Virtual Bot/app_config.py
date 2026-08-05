"""
«Клод Бот» — Virtual Bot: завантаження конфігурації.

Читає config.yaml (без секретів) і окремо дістає секрети:
- токен OpenClaw: env OPENCLAW_TOKEN (пріоритет) або з "Voice Loop/config.yaml";
- ключ Anthropic: тільки env ANTHROPIC_API_KEY.

Секрети НІКОЛИ не потрапляють у відповіді API і в статику.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import yaml

# Коренева папка Virtual Bot (де лежить цей файл)
BASE_DIR = Path(__file__).resolve().parent


def _parse_dotenv_value(value: str) -> str:
    """
    Розбирає праву частину рядка .env (як шел у `set -a; . ./.env`):
    - "подвійні лапки": вміст до першої НЕекранованої лапки; \\" і \\\\ розекрановуємо;
    - 'одинарні лапки': вміст до наступної лапки, без екранування;
    - без лапок: відрізаємо інлайн-коментар « #...» (пробіл перед #).
    """
    value = value.strip()
    if value[:1] == '"':
        out: list[str] = []
        i = 1
        while i < len(value):
            ch = value[i]
            if ch == "\\" and i + 1 < len(value) and value[i + 1] in ('"', "\\"):
                out.append(value[i + 1])
                i += 2
                continue
            if ch == '"':
                break
            out.append(ch)
            i += 1
        return "".join(out)
    if value[:1] == "'":
        end = value.find("'", 1)
        return value[1:end] if end != -1 else value[1:]
    return re.split(r"\s+#", value, maxsplit=1)[0].strip()


def _load_dotenv(path: Path) -> None:
    """
    Легкий парсер .env → os.environ (без залежностей).

    Формат: KEY=VALUE. Значення можна брати в лапки; інлайн-коментар « #...»
    після незалапкованого значення відрізається (як робить шел у start.sh);
    повнорядкові # — коментарі; префікс export ігнорується. Семантика — як у
    `set -a; . ./.env`: у самому файлі ОСТАННЄ значення ключа виграє, але вже
    наявні змінні оточення НЕ перезаписуємо (реальний `export OMNI_API_KEY=...`
    має пріоритет над файлом). Значення — можливі секрети: нічого НЕ логуємо.
    Битий не-UTF-8 файл трактуємо як «недоступний» (не валимо імпорт модуля).
    """
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return  # .env немає / недоступний / битий у кодуванні — це нормально
    parsed: dict[str, str] = {}
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if key.startswith("export "):
            key = key[len("export "):].strip()
        if key:
            parsed[key] = _parse_dotenv_value(value)  # останній у файлі виграє
    for key, value in parsed.items():
        os.environ.setdefault(key, value)  # справжня env-змінна має пріоритет


# Секрети з .env (OMNI_API_KEY тощо) — до першого читання ключів.
# Файл .env — секрет: у git/вікі/фронтенд не потрапляє.
_load_dotenv(BASE_DIR / ".env")


def _load_yaml(path: Path) -> dict[str, Any]:
    """Читає YAML-файл; якщо файлу нема або він битий — повертає порожній dict."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, yaml.YAMLError):
        return {}


# Основний конфіг
CONFIG: dict[str, Any] = _load_yaml(BASE_DIR / "config.yaml")


def cfg(*keys: str, default: Any = None) -> Any:
    """Дістає вкладене значення з CONFIG: cfg("openclaw", "base_url")."""
    node: Any = CONFIG
    for key in keys:
        if not isinstance(node, dict) or key not in node:
            return default
        node = node[key]
    return node


def resolve_path(*keys: str, default: str) -> Path:
    """Шлях із конфігу, розвʼязаний відносно папки Virtual Bot."""
    raw = cfg(*keys, default=default)
    path = Path(str(raw)).expanduser()
    if not path.is_absolute():
        path = BASE_DIR / path
    return path.resolve()


def cfg_float(*keys: str, default: float) -> float:
    """
    Числове (float) значення з конфігу, стійке до None/порожнього/сміття →
    default (щоб YAML-null чи `key:` без значення не валили імпорт через
    float(None)). Явний 0 ШАНУЄТЬСЯ (0.0), тож напр. omni_backoff_s: 0 реально
    вимикає запобіжник — на відміну від `float(x or default)`.
    """
    raw = cfg(*keys, default=default)
    try:
        return float(raw)
    except (TypeError, ValueError):
        return float(default)


def cfg_int(*keys: str, default: int) -> int:
    """Ціле значення з конфігу, стійке до None/порожнього/сміття → default."""
    raw = cfg(*keys, default=default)
    try:
        return int(raw)
    except (TypeError, ValueError):
        return int(default)


def cfg_str(*keys: str, default: str) -> str:
    """Рядок із конфігу; None/порожнє → default (щоб не було рядка "None")."""
    raw = cfg(*keys, default=default)
    text = str(raw).strip() if raw is not None else ""
    return text or default


# Часто вживані шляхи
BRAIN_DIR = resolve_path("paths", "brain_dir", default="brain")
STATIC_DIR = resolve_path("paths", "static_dir", default="static")
UPLOADS_DIR = resolve_path("paths", "uploads_dir", default="uploads")
# Робоча тека бота на диску (файли, проєкти, ігри, теки сесій)
WORKSPACE_DIR = resolve_path("paths", "workspace_dir", default="workspace")
SERVICE_LOGS_DIR = resolve_path("paths", "service_logs_dir", default="service_logs")
VISION_DIR = resolve_path("vision", "dir", default="../Vision Agent")
DISPLAY_DIR = resolve_path("display", "dir", default="../claude-bot-display")

# Базові URL сусідніх сервісів. Числа читаємо через cfg_float/cfg_int (стійкі до
# null/порожнього і шанують явний 0), рядки — через cfg_str (null/порожнє → default).
# Omni-роутер (головний мозок): base_url уже містить /v1 (rstrip прибирає лише «/»).
OMNI_BASE_URL: str = cfg_str("omni", "base_url", default="http://localhost:20128/v1").rstrip("/")
OMNI_DEFAULT_MODEL: str = cfg_str("omni", "default_model", default="claude/claude-sonnet-5")
# Запасна модель Omni («другий мозок»); порожнє/null → без запасної
_omni_fallback_raw = cfg("omni", "fallback_model", default="")
OMNI_FALLBACK_MODEL: str = str(_omni_fallback_raw).strip() if _omni_fallback_raw else ""
OMNI_VISION_MODEL: str = cfg_str("omni", "vision_model", default="opencode-go/minimax-m3")
OMNI_TIMEOUT_S: float = cfg_float("omni", "timeout_s", default=60)
# Чат: короткий таймаут спроби Omni і бекоф-запобіжник після невдачі
# (щоб завислий роутер не додавав десятки секунд до кожної відповіді чату)
CHAT_OMNI_TIMEOUT_S: float = cfg_float("chat", "omni_timeout_s", default=25)
CHAT_OMNI_BACKOFF_S: float = cfg_float("chat", "omni_backoff_s", default=60)
# Скільки повідомлень зберігати в історії сесії чату
CHAT_HISTORY_LIMIT: int = cfg_int("chat", "history_limit", default=20)


def _load_omni_models() -> list[dict[str, str]]:
    """Кований список моделей Omni з config.yaml → [{"id","label"}]."""
    raw = cfg("omni", "models", default=[])
    out: list[dict[str, str]] = []
    if isinstance(raw, list):
        for item in raw:
            if isinstance(item, dict) and item.get("id"):
                mid = str(item["id"])
                # `or mid` — щоб явний null/порожній label не став підписом "None"
                out.append({"id": mid, "label": str(item.get("label") or mid)})
            elif isinstance(item, str) and item.strip():
                out.append({"id": item.strip(), "label": item.strip()})
    # Гарантуємо, що модель за замовчуванням присутня у списку вибору
    if OMNI_DEFAULT_MODEL and not any(m["id"] == OMNI_DEFAULT_MODEL for m in out):
        out.insert(0, {"id": OMNI_DEFAULT_MODEL, "label": OMNI_DEFAULT_MODEL})
    return out


OMNI_MODELS: list[dict[str, str]] = _load_omni_models()

OPENCLAW_BASE_URL: str = cfg_str("openclaw", "base_url", default="http://127.0.0.1:18789").rstrip("/")
OPENCLAW_AGENT: str = cfg_str("openclaw", "agent", default="openclaw/default")
OPENCLAW_TIMEOUT_S: float = cfg_float("openclaw", "timeout_s", default=45)
# Чат: окремий КОРОТКИЙ таймаут спроби OpenClaw і бекоф-запобіжник після невдачі
# (щоб завислий gateway не додавав десятки секунд до кожної відповіді чату)
CHAT_OPENCLAW_TIMEOUT_S: float = cfg_float("chat", "openclaw_timeout_s", default=10)
CHAT_OPENCLAW_BACKOFF_S: float = cfg_float("chat", "openclaw_backoff_s", default=120)
ANTHROPIC_MODEL: str = cfg_str("anthropic", "model", default="claude-sonnet-5")
ANTHROPIC_MAX_TOKENS: int = cfg_int("anthropic", "max_tokens", default=1024)
ANTHROPIC_TIMEOUT_S: float = cfg_float("anthropic", "timeout_s", default=60)
CHAT2API_BASE_URL: str = cfg_str("chat2api", "base_url", default="http://127.0.0.1:8080/v1").rstrip("/")
CHAT2API_MODEL: str = cfg_str("chat2api", "model", default="Qwen3.7-Max")
CHAT2API_TIMEOUT_S: float = cfg_float("chat2api", "timeout_s", default=60)
VISION_BASE_URL: str = cfg_str("vision", "base_url", default="http://127.0.0.1:8000").rstrip("/")
DISPLAY_BASE_URL: str = cfg_str("display", "base_url", default="http://127.0.0.1:8001").rstrip("/")


def httpx_trust_env(url: str) -> bool:
    """
    Чи можна для цього URL довіряти проксі-налаштуванням оточення/системи.

    Для локальних сервісів (127.0.0.1 / localhost / ::1) — НІ: httpx через
    urllib.getproxies() підхоплює навіть системний проксі macOS, а localhost
    часто відсутній у його винятках — тоді всі локальні виклики йшли б через
    проксі (напр., 407 Proxy Authentication Required) і «брехали» у статусі.
    Для зовнішніх URL (api.anthropic.com тощо) — так, проксі може бути потрібен.
    """
    host = (urlparse(url).hostname or "").lower()
    return host not in {"127.0.0.1", "localhost", "::1"}


def get_openclaw_token() -> str | None:
    """
    Токен OpenClaw: спершу env OPENCLAW_TOKEN, інакше — з config.yaml Voice Loop.
    Повертає None, якщо токена ніде нема. Значення — секрет, не логувати!
    """
    env_token = os.environ.get("OPENCLAW_TOKEN", "").strip()
    if env_token:
        return env_token

    voice_cfg_path = resolve_path("openclaw", "voice_loop_config", default="../Voice Loop/config.yaml")
    voice_cfg = _load_yaml(voice_cfg_path)
    token = voice_cfg.get("openclaw", {}) if isinstance(voice_cfg.get("openclaw"), dict) else {}
    value = str(token.get("token", "")).strip()
    return value or None


def get_omni_key() -> str | None:
    """
    Ключ Omni-роутера — тільки з env OMNI_API_KEY (зазвичай із файлу .env).
    Повертає None, якщо ключа нема. Значення — секрет, не логувати!
    """
    key = os.environ.get("OMNI_API_KEY", "").strip()
    return key or None


def get_anthropic_key() -> str | None:
    """Ключ Anthropic API — тільки з env ANTHROPIC_API_KEY."""
    key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    return key or None


def get_chat2api_key() -> str | None:
    """
    Необовʼязковий ключ Chat2API — тільки з env CHAT2API_API_KEY.
    Якщо None — запити йдуть БЕЗ заголовка Authorization (типовий локальний
    Chat2API авторизації не вимагає). Значення — секрет, не логувати!
    """
    key = os.environ.get("CHAT2API_API_KEY", "").strip()
    return key or None
