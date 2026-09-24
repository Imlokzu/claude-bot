"""
Моделі й рівень думання САМОГО OpenClaw.

Навіщо окремий модуль. У панелі був вибір моделі зі списку `omni.models`
(config.yaml) — і він НЕ ВПЛИВАВ ні на що. Відповідає в чаті OpenClaw, а він
бере модель зі свого конфіга (`agents.defaults.model.primary`), тож на екрані
могло стояти «MiniMax M3», поки насправді писав gpt-oss-120b. Вибір, який
нічого не вибирає, гірший за його відсутність.

Звідки що беремо (перевірено живими викликами 2026-09-19):

* СПИСОК моделей — `openclaw models list --json`. HTTP-ендпоінт `/v1/models`
  віддає лише імена АГЕНТІВ (`openclaw`, `openclaw/default`, `openclaw/main`),
  а не моделі, тож без CLI тут не обійтись.
* ВИБІР моделі — заголовок `x-openclaw-model: <provider/model>` на
  `/v1/chat/completions`. Це офіційний спосіб (docs.openclaw.ai/gateway/
  openai-http-api); поле `model` у тілі — це агент, а не модель, і рядок
  `omni/opencode-go/minimax-m3` там дає 400.
* РІВЕНЬ ДУМАННЯ — `agents.defaults.thinkingDefault`. Заголовка під нього
  НЕМАЄ: HTTP-ендпоінт не приймає жодного поля про reasoning. Тому рівень
  ставиться через `openclaw config set` — CLI сам пише «Change will apply
  without restarting the gateway». Це НАЛАШТУВАННЯ, а не властивість однієї
  репліки, і в панелі воно так і підписане.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import shutil
import time

import app_config as cfg

log = logging.getLogger("virtual_bot.openclaw_models")

# Рівні думання — рівно ті, що в схемі конфіга OpenClaw
# (agents.defaults.thinkingDefault). Свої назви тут вигадувати не можна:
# невідомий рівень CLI просто відкине.
THINKING_LEVELS: tuple[str, ...] = (
    "off", "minimal", "low", "medium", "high", "xhigh", "adaptive", "max", "ultra",
)

# The picker lists every OpenAI model, plus Regolo. Other providers
# stay out: they were in the catalog and did not answer.

_CLI_TIMEOUT_S = 20.0
# Каталог моделей міняється рідко (правка конфіга або `models refresh`), а
# кожен виклик CLI — це запуск node на ~1 с. Тому тримаємо кеш.
_CATALOG_TTL_S = 120.0

_catalog: list[dict] | None = None
_catalog_at: float = 0.0
_selected: str = ""
_lock = asyncio.Lock()


def cli_path() -> str | None:
    """Шлях до `openclaw` або None, якщо CLI не встановлено."""
    return shutil.which("openclaw")


async def _run_cli(*args: str) -> tuple[int, str, str]:
    """Викликає openclaw CLI. Повертає (код, stdout, stderr)."""
    exe = cli_path()
    if not exe:
        return 127, "", "openclaw CLI не знайдено"
    proc = await asyncio.create_subprocess_exec(
        exe, *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout=_CLI_TIMEOUT_S)
    except asyncio.TimeoutError:
        proc.kill()
        return 124, "", "openclaw CLI не відповів"
    return proc.returncode or 0, out.decode("utf-8", "replace"), err.decode("utf-8", "replace")


# Назви в каталозі OpenClaw тягнуть за собою хвіст у дужках — «MiniMax M3
# (бачить картинки, ~1.9 с)». У вузькому рядку композера він з'їдав усю
# ширину й обрізався саме на корисному місці, тож хвіст тут розбирається на
# ознаки, а панель малює їх іконками. Сама назва лишається назвою.
_TAIL_RE = re.compile(r"\s*\(([^()]*)\)\s*$")
_SECONDS_RE = re.compile(r"~\s*([0-9]+(?:[.,][0-9]+)?)\s*(?:с|s)\b")
_VISION_WORDS = ("картинк", "vision", "image", "зображенн")

# Межа «швидкої». Порівнювати моделі між собою було б гнучкіше, але й
# мінливо: та сама модель то отримувала б значок, то ні, залежно від того,
# хто поруч у списку. Фіксований поріг людина може запам'ятати.
FAST_SECONDS = 1.0


def _normalize(raw: dict) -> dict:
    """Модель OpenClaw → форма, яку чекає панель."""
    key = str(raw.get("key") or "")
    tags = [str(t) for t in (raw.get("tags") or [])]
    name = str(raw.get("name") or key)
    tail = ""
    match = _TAIL_RE.search(name)
    if match:
        tail = match.group(1)
        name = name[: match.start()].strip() or key
    entry: dict[str, object] = {
        "id": key,
        "label": name,
        # Хто саме відповідає: у ключі `omni/opencode-go/minimax-m3` перший
        # сегмент — провайдер OpenClaw, решта — модель у ньому.
        "provider": key.split("/")[0] if "/" in key else "",
        "available": bool(raw.get("available", True)),
    }
    context = raw.get("contextWindow")
    if isinstance(context, int) and context > 0:
        entry["context"] = context
    # `input` у каталозі стоїть "text" навіть у зрячих моделей, тож єдиний
    # живий сигнал — слова в тому самому хвості.
    haystack = f"{tail} {raw.get('input') or ''}".lower()
    if any(word in haystack for word in _VISION_WORDS):
        entry["vision"] = True
    seconds = _SECONDS_RE.search(tail)
    if seconds:
        value = float(seconds.group(1).replace(",", "."))
        entry["seconds"] = value
        if value <= FAST_SECONDS:
            entry["fast"] = True
    if "default" in tags:
        entry["is_default"] = True
    fallback = next((t for t in tags if t.startswith("fallback")), "")
    if fallback:
        entry["fallback"] = fallback
    return entry


async def catalog(force: bool = False) -> list[dict]:
    """Список моделей OpenClaw (кешований)."""
    global _catalog, _catalog_at
    async with _lock:
        fresh = _catalog is not None and (time.monotonic() - _catalog_at) < _CATALOG_TTL_S
        if fresh and not force:
            return list(_catalog or [])
        code, out, err = await _run_cli("models", "list", "--json")
        if code != 0:
            log.warning("openclaw models list: код %d (%s)", code, err.strip()[:120])
            return list(_catalog or [])
        try:
            data = json.loads(out)
        except json.JSONDecodeError:
            log.warning("openclaw models list віддав не-JSON")
            return list(_catalog or [])
        models = [_normalize(m) for m in data.get("models", []) if m.get("key")]
        _catalog = [m for m in models if _shown(m)]
        _catalog_at = time.monotonic()
        return list(_catalog)


def _shown(model: dict) -> bool:
    """OpenAI in full, and Regolo. A single 'default' row is not a model name."""
    if not model.get("id"):
        return False
    return str(model.get("provider") or "") in {"openai", "regolo"}


def default_model(models: list[dict]) -> str:
    """Модель, якою OpenClaw відповідає без нашого втручання."""
    for model in models:
        if model.get("is_default"):
            return str(model["id"])
    return ""


def get_selected() -> str:
    """Наш перекрив моделі; порожньо — лишаємо типову модель OpenClaw."""
    return _selected


def set_selected(model: str) -> bool:
    """
    Ставить перекрив моделі. Перевірку за каталогом робить викликач: тут
    немає async-контексту, а мовчазно ковтати невідомий рядок не можна —
    він поїхав би заголовком і кожна репліка падала б з 400.
    """
    global _selected
    _selected = (model or "").strip()
    return True


def chat_headers() -> dict[str, str]:
    """Заголовки перекриву для /v1/chat/completions."""
    return {"x-openclaw-model": _selected} if _selected else {}


async def get_thinking() -> str:
    """
    Поточний рівень думання. Порожній рядок — значення не задане, діє
    вбудоване типове OpenClaw (його CLI не називає, тому й ми не вигадуємо).
    """
    code, out, _err = await _run_cli("config", "get", "agents.defaults.thinkingDefault")
    value = out.strip()
    if code != 0 or not value or value.startswith("Config path is valid but unset"):
        return ""
    # Значення може прийти в лапках (--json) або голим рядком.
    return value.strip('"').strip()


async def set_thinking(level: str) -> bool:
    """
    Ставить рівень думання. Порожній рядок ПРИБИРАЄ налаштування — тоді знову
    діє типове значення OpenClaw, а не наше уявлення про нього.
    """
    level = (level or "").strip().casefold()
    if level and level not in THINKING_LEVELS:
        return False
    args = (
        ("config", "unset", "agents.defaults.thinkingDefault")
        if not level
        else ("config", "set", "agents.defaults.thinkingDefault", level)
    )
    code, _out, err = await _run_cli(*args)
    if code != 0:
        log.warning("openclaw config %s: код %d (%s)", args[1], code, err.strip()[:120])
    return code == 0


def reachable() -> bool:
    """Чи є сенс питати CLI взагалі."""
    return bool(cli_path() and cfg.get_openclaw_token())
