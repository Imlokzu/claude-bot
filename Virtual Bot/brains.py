"""
«Клод Бот» — Virtual Bot: «мозок» чату з пʼятьма режимами (за пріоритетом):

0) OpenClaw gateway (127.0.0.1:18789, OpenAI-сумісний /v1/chat/completions) —
   ГОЛОВНИЙ мозок: памʼять, tool use, маршрутизація до Claude (за баченням
   власника через нього має йти все). Ендпоінт треба увімкнути в конфізі OpenClaw;
1) Omni-роутер (127.0.0.1:20128/v1) — запасний OpenAI-сумісний мультимодельний
   шлюз; модель обирається у панелі (за замовчуванням Claude);
2) прямий Anthropic API (httpx, БЕЗ SDK);
3) Chat2API — локальний OpenAI-сумісний сервер (127.0.0.1:8080/v1);
4) демо-режим — заготовлені українські відповіді за ключовими словами,
   щоб застосунок працював завжди.

Кожна відповідь проходить через шар емоцій (emotions.py).
Модуль памʼятає, який мозок РЕАЛЬНО відповів останнім (last_successful_brain) —
/api/status показує його як mode замість «оптимістичної» оцінки за пінгом.
"""

from __future__ import annotations

import asyncio
from datetime import datetime
import json
import logging
import re
import time
from pathlib import Path

import httpx

import app_config as cfg
import brain_context
import profile_store
import trace_log
from emotions import ALLOWED_EMOTIONS, extract_emotion, guess_emotion
from memory import append_user_profile, find_relevant_notes, load_user_profile
import tools as tool_registry

# Тип історії сесії: [{'role': 'user'|'assistant', 'content': str}, ...]
ChatHistory = list[dict[str, str]]
ImageAttachment = dict[str, str]

log = logging.getLogger("virtual_bot.brains")

# Що каже бот, коли не відповів ЖОДЕН мозок і демо-затичка вимкнена.
# Свідомо НЕ вдаємо розмову: це повідомлення про поломку, а не репліка бота.
_OFFLINE_REPLY = "Зараз я без мозку — жоден із них не відповів. Загляни в консоль."

# ------------------------------------------------------------------ промпт

# Фіксовані правила тегів емоцій (мова/імʼя/характер — з профілю, див. нижче)
_EMOTION_RULES = """- ПОЧИНАЙ КОЖНУ відповідь тегом емоції у форматі [емоція:назва], де назва — рівно одна з: \
idle, listening, thinking, speaking, happy, sad, confused, surprised, love, sleepy, \
searching, web, working, writing, asking, greeting, loading, celebrating, cool.
- Емоції-настрої: happy, sad, surprised, confused, love, sleepy, thinking, listening, speaking, idle, cool.
- Емоції-дії — став їх, коли РЕАЛЬНО робиш це у відповіді:
  * searching — шукаєш/читаєш у файлах, нотатках чи результатах пошуку;
  * web — шукаєш в інтернеті / у вебі;
  * working — виконуєш задачу, кодуєш чи щось обробляєш;
  * writing — пишеш нотатку або зберігаєш щось у памʼять;
  * asking — САМ ставиш користувачу запитання;
  * greeting — вітаєшся (привіт/до побачення);
  * celebrating — радієш успіху чи святкуєш;
  * loading — статус: щось завантажується/довго обробляється.
- Приклади: "[емоція:asking] А як тебе звати?" / "[емоція:web] Пошукаю це в мережі…"
- Після тега — звичайний текст без інших тегів."""


def _tools_instruction() -> str:
    """Додає в системний промпт перелік доступних публічних інструментів."""
    tools = tool_registry.list_tools()
    if not tools:
        return ""
    lines = [
        "\nУ тебе є доступ до публічних інструментів (functions).",
        "ПРАВИЛА ВИКОРИСТАННЯ ІНСТРУМЕНТІВ (дотримуйся жорстко):",
        "- Якщо питання стосується погоди, курсу валют, факту/визначення, поточних подій або будь-яких даних, у яких ти не впевнений — ЗАВЖДИ викликай відповідний інструмент. НЕ вигадуй відповідь.",
        "- Для будь-якого питання, що потребує актуальної або фактологічної інформації, спочатку використай web_search, facts, weather або currency.",
        "- Не пиши 'я не знаю' без спроби пошуку. Пошукай інструментом і дай відповідь на основі результатів.",
        "- Якщо інструмент повернув помилку, повідом про це чесно, але не вигадуй дані.",
        "- Якщо запит стосується користувача або минулих розмов, спочатку викликай memory_search.",
        "Доступні інструменти:",
    ]
    for t in tools:
        fn = t.get("function", {})
        name = fn.get("name", "")
        desc = fn.get("description", "")
        if name:
            lines.append(f"- {name}: {desc}")
    lines.append("Коли ти викликаєш інструмент, почни відповідь із тега [емоція:web] або [емоція:searching], а після обробки результатів — звичайний тег емоції.")
    return "\n".join(lines)


def build_system_prompt(user_message: str) -> str:
    """
    Системний промпт із ПРОФІЛЮ (майстер налаштування): імʼя, мова, характер —
    реально впливають на відповідь. Плюс правила тегів емоцій, топ-3 нотатки,
    публічні інструменти та профіль користувача (довгострокова памʼять).
    """
    prof = profile_store.load()
    name = prof.get("name") or "Клод Бот"
    base = (
        f"Ти — «{name}», DIY робот-компаньйон. Зараз ти живеш у віртуальному втіленні "
        f"(веб-панель на компʼютері власника), а згодом переїдеш у справжнє тіло на "
        f"Raspberry Pi 3 з камерою та маленьким дисплеєм.\n\n"
        f"{profile_store.persona_prompt(prof)}\n\n"
        f"Правила:\n"
        f"- {profile_store.language_instruction(prof)} {profile_store.style_prompt(prof)}\n"
        f"{_EMOTION_RULES}"
    )
    now = datetime.now().astimezone()
    parts = [
        base,
        "\nТочний поточний локальний час сервера: "
        f"{now.isoformat(timespec='seconds')} ({now.tzname() or 'local'}). "
        "Використовуй його для питань про сьогодні, дату, час і часові проміжки.",
    ]
    parts.append(_tools_instruction())

    owner_root = brain_context.init_user_brain(None)
    profiles = [load_user_profile().strip()]
    owner_profile = load_user_profile(owner_root).strip()
    if owner_profile and owner_profile not in profiles:
        profiles.append(owner_profile)
    user_profile = "\n".join(profile for profile in profiles if profile)
    if user_profile:
        parts.append(
            "\nПро користувача (довгострокова памʼять; використовуй без повторного запитання):\n"
            f"{user_profile}"
        )
    parts.append(
        "\nПРАВИЛО ПАМʼЯТІ: якщо користувач питає про себе або раніше повідомлений факт, "
        "спочатку перевір профіль і релевантні нотатки. Не кажи «я не знаю» і не "
        "проси повторити факт, доки не використав доступну памʼять."
    )

    owner_notes = find_relevant_notes(user_message, top_n=3, root=owner_root)
    session_notes = find_relevant_notes(user_message, top_n=3)
    known_paths = {note["path"] for note in owner_notes}
    notes = owner_notes + [
        note for note in session_notes if note["path"] not in known_paths
    ]
    notes = notes[:3]
    if notes:
        lines = ["\nТвоя памʼять (нотатки з brain/, використовуй якщо доречно):"]
        for note in notes:
            lines.append(f"--- {note['title']} ({note['path']}) ---\n{note['snippet']}")
        parts.append("\n".join(lines))
    return "\n".join(parts)


# ------------------------------------------------------------------ доступність

# Жорстка стеля ОДНІЄЇ перевірки доступності для /api/status: таймаут httpx —
# по-фазний, тож сервіс, що «цідить» відповідь по байту, тримав би статус
# нескінченно. wait_for гарантує, що кожна перевірка вкладається у ~2 с.
_ALIVE_CHECK_WALL_S = 2.0


async def check_openclaw_reachable(client: httpx.AsyncClient) -> bool:
    """Чи відповідає gateway OpenClaw (будь-який HTTP-статус = живий)."""
    try:
        await asyncio.wait_for(
            client.get(cfg.OPENCLAW_BASE_URL, timeout=1.5),
            timeout=_ALIVE_CHECK_WALL_S,
        )
        return True
    except Exception:  # noqa: BLE001 — статус не має права падати через битий base_url
        return False


async def check_chat2api_alive(client: httpx.AsyncClient) -> bool:
    """Чи живий Chat2API: швидкий GET /models має відповісти 200."""
    try:
        resp = await asyncio.wait_for(
            client.get(
                f"{cfg.CHAT2API_BASE_URL}/models",
                headers=_chat2api_headers(),
                timeout=1.5,
            ),
            timeout=_ALIVE_CHECK_WALL_S,
        )
        return resp.status_code == 200
    except Exception:  # noqa: BLE001 — статус не має права падати через битий base_url
        return False


# ------------------------------------------------------------- останній мозок

# Який мозок реально відповів на останній /api/chat (None — чату ще не було).
# /api/status бере його як mode: ping може «брехати» (gateway живий, але
# chatCompletions віддає 500), а цей факт — ні.
_last_successful_brain: str | None = None


def _fail_detail(exc: BaseException, timeout_s: float | None = None) -> str:
    """
    Текст падіння для консолі. У asyncio.TimeoutError str(exc) ПОРОЖНІЙ —
    без цього в консолі висів безглуздий рядок «TimeoutError:», який не
    каже головного: скільки саме ми чекали, перш ніж здатись.
    """
    text = str(exc).strip()
    if text:
        return f"{type(exc).__name__}: {text}"
    if isinstance(exc, asyncio.TimeoutError) and timeout_s:
        return f"TimeoutError: не вклався у {timeout_s:.0f} с"
    return type(exc).__name__


def _elapsed_ms(started: float) -> float:
    """Скільки тривала спроба мозку (мс) — для кроків консолі."""
    return (time.perf_counter() - started) * 1000


def get_last_successful_brain() -> str | None:
    """Мозок, що реально відповів на останній чат, або None до першого чату."""
    return _last_successful_brain


# Модель, якою РЕАЛЬНО відповіли востаннє. Панель показує саме її: ланцюг
# мозків мовчки перемикається при збоях, і без цього користувач бачив би
# у селекторі одне, а відповідала б зовсім інша модель.
_last_model: str = ""


def _openclaw_agent_model() -> str:
    """
    Яка модель насправді стоїть за агентом OpenClaw.

    Шлюз у відповіді пише лише ім'я агента («openclaw/default»), а це нікому
    нічого не каже. Справжня модель лежить у конфізі OpenClaw — читаємо її
    звідти й показуємо в панелі; якщо конфіг недоступний, лишається агент.
    """
    path = Path.home() / ".openclaw" / "openclaw.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        model = data["agents"]["defaults"]["model"]["primary"]
    except Exception:  # noqa: BLE001 — конфіг чужого застосунку може змінитись
        return ""
    # «omni/opencode-go/minimax-m3» → «minimax-m3»: показуємо саму модель
    return str(model).split("/")[-1] if model else ""


def get_last_model() -> str:
    if _last_successful_brain == "openclaw":
        real = _openclaw_agent_model()
        if real:
            return f"{real} · OpenClaw"
    return _last_model


def _remember_brain(mode: str, model: str = "") -> None:
    global _last_successful_brain, _last_model
    _last_successful_brain = mode
    _last_model = model or mode


# ------------------------------------------------------------------ мозок 0: Omni-роутер

# Обрана у панелі модель Omni (None → cfg.OMNI_DEFAULT_MODEL). Тримаємо в памʼяті
# процесу; /api/models показує список і вибір, /api/model змінює. Дозволяємо
# лише моделі з кованого списку config.yaml — довільні рядки не приймаємо.
_selected_omni_model: str | None = None
_last_omni_model: str = ""

_REASONING_LEVELS = ("none", "low", "medium", "high")
_REASONING_MODEL_MARKERS = ("deepseek", "qwen", "kimi", "glm", "minimax", "grok")


def _omni_model_ids() -> set[str]:
    return {m["id"] for m in cfg.OMNI_MODELS}


def get_selected_omni_model() -> str:
    """Активна модель Omni: обрана в панелі (якщо валідна) або типова з конфіга."""
    if _selected_omni_model and _selected_omni_model in _omni_model_ids():
        return _selected_omni_model
    return cfg.OMNI_DEFAULT_MODEL


def set_selected_omni_model(model: str) -> bool:
    """Ставить модель Omni, якщо вона в кованому списку. True — успіх, False — відмова."""
    global _selected_omni_model
    if model in _omni_model_ids():
        _selected_omni_model = model
        return True
    return False


def reasoning_capability(model: str) -> dict:
    """Public, provider-safe reasoning metadata for a configured model."""
    supported = any(marker in (model or "").casefold() for marker in _REASONING_MODEL_MARKERS)
    return {
        "supported": supported,
        "levels": list(_REASONING_LEVELS if supported else ("none",)),
        "default": "none",
    }


def models_with_capabilities() -> list[dict]:
    return [
        {**model, "reasoning": reasoning_capability(model["id"])}
        for model in cfg.OMNI_MODELS
    ]


def _reasoning_payload(model: str, reasoning_effort: str | None) -> dict:
    """Forward effort only to model families that accept the OpenAI-style field."""
    effort = (reasoning_effort or "none").casefold()
    capability = reasoning_capability(model)
    if not capability["supported"] or effort == "none":
        return {}
    if effort not in capability["levels"]:
        raise ValueError("Непідтримуваний рівень міркування")
    return {"reasoning_effort": effort}


async def check_omni_reachable(client: httpx.AsyncClient) -> bool:
    """Чи живий Omni-роутер: GET /models з ключем має відповісти 200 (без ключа — офлайн)."""
    key = cfg.get_omni_key()
    if not key:
        return False
    try:
        resp = await asyncio.wait_for(
            client.get(
                f"{cfg.OMNI_BASE_URL}/models",
                headers={"Authorization": f"Bearer {key}"},
                timeout=1.5,
            ),
            timeout=_ALIVE_CHECK_WALL_S,
        )
        return resp.status_code == 200
    except Exception:  # noqa: BLE001 — статус не має права падати через битий base_url/ключ
        return False


# Запобіжник (circuit breaker) для чату через Omni: монотонна мітка останньої
# НЕВДАЧІ (None — невдач не було / остання спроба вдалася). Поки з моменту
# невдачі минуло < CHAT_OMNI_BACKOFF_S — Omni у чаті пропускаємо одразу, без
# мережевої спроби (завислий роутер інакше додавав би затримку до КОЖНОГО
# повідомлення). На /api/status це не впливає: там власна стеля перевірки.
_omni_failed_at_mono: float | None = None


def omni_backoff_remaining() -> float:
    """Скільки секунд запобіжник ще пропускатиме Omni (0 — можна пробувати)."""
    if _omni_failed_at_mono is None:
        return 0.0
    remaining = cfg.CHAT_OMNI_BACKOFF_S - (time.monotonic() - _omni_failed_at_mono)
    return max(0.0, remaining)


def _omni_note_failure() -> None:
    global _omni_failed_at_mono
    _omni_failed_at_mono = time.monotonic()


def _omni_note_success() -> None:
    """Успішна відповідь Omni скидає запобіжник."""
    global _omni_failed_at_mono
    _omni_failed_at_mono = None


async def _omni_call(
    message: str,
    system_prompt: str,
    model: str,
    history: ChatHistory,
    emit=None,
    reasoning_effort: str | None = None,
    images: list[ImageAttachment] | None = None,
) -> tuple[str, list[dict]]:
    """Одна спроба Omni з конкретною моделлю. Ключ — секрет, у відповіді/логах не світимо."""
    key = cfg.get_omni_key()
    if not key:
        raise RuntimeError("Немає ключа Omni (OMNI_API_KEY)")

    messages = _build_messages(system_prompt, history, message, images)
    payload = {
        "model": model,
        "messages": messages,
        # Стрімінг не використовуємо — читаємо відповідь цілком
        "stream": False,
        **_reasoning_payload(model, reasoning_effort),
    }
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    url = f"{cfg.OMNI_BASE_URL}/chat/completions"
    trust_env = cfg.httpx_trust_env(cfg.OMNI_BASE_URL)

    # СПРАВЖНІЙ стрімінг токенів, коли є куди їх віддавати (emit).
    # Якщо модель захоче тулзи або стрім взагалі не заведеться —
    # тихо падаємо на звичайний шлях із повною підтримкою tool_calls.
    if emit is not None:
        try:
            text = await _stream_openai_compatible(
                url, headers, payload, cfg.OMNI_TIMEOUT_S, trust_env, emit=emit
            )
            return text, []
        except _NeedsTools:
            log.info("Модель %s потребує тулзів — переходжу на нестрімовий виклик", model)
        except Exception as exc:  # noqa: BLE001 — стрім не вийшов, працюємо як раніше
            log.warning("Стрімінг Omni не вдався (%s) — звичайний виклик", type(exc).__name__)

    return await _call_openai_compatible_with_tools(
        url,
        headers,
        payload,
        tool_registry.list_tools(),
        cfg.OMNI_TIMEOUT_S,
        trust_env,
        emit=emit,
    )


async def chat_omni(
    message: str,
    system_prompt: str,
    history: ChatHistory,
    emit=None,
    reasoning_effort: str | None = None,
    images: list[ImageAttachment] | None = None,
) -> tuple[str, list[dict]]:
    """
    Omni-роутер: пробує ОБРАНУ модель; якщо вона впала (напр. 401/404/503 від
    провайдера) — пробує запасну (OMNI_FALLBACK_MODEL, «другий мозок» opencode-go).
    Обидві невдачі → RuntimeError, і chat() падає на наступний мозок.
    """
    global _last_omni_model
    selected = get_selected_omni_model()
    if images and cfg.OMNI_VISION_MODEL:
        # З картинками — ОДРАЗУ перевірена vision-модель. Обрана в панелі
        # майже завжди текстова, а «не бачу картинки» від неї — це успішна
        # відповідь для ланцюга: виключення немає, тож fallback на
        # OMNI_VISION_MODEL нижче ніколи б не спрацював.
        selected = cfg.OMNI_VISION_MODEL
    try:
        result = await _omni_call(
            message, system_prompt, selected, history, emit=emit,
            reasoning_effort=reasoning_effort,
            images=images,
        )
        _last_omni_model = selected
        return result
    except Exception as primary_exc:  # noqa: BLE001 — падаємо на запасну модель
        # Для зображень потрібен перевірений multimodal fallback: текстовий Kimi
        # може прийняти payload, але не гарантує, що реально бачить пікселі.
        fallback = cfg.OMNI_VISION_MODEL if images else cfg.OMNI_FALLBACK_MODEL
        if fallback and fallback != selected:
            log.warning(
                "Omni-модель %s не відповіла (%s), пробую запасну %s",
                selected, type(primary_exc).__name__, fallback,
            )
            result = await _omni_call(
                message, system_prompt, fallback, history, emit=emit,
                reasoning_effort=reasoning_effort,
                images=images,
            )
            _last_omni_model = fallback
            return result
        raise


# ------------------------------------------------------------------ мозок 1: OpenClaw

# Запобіжник (circuit breaker) для чату через OpenClaw: монотонна мітка
# останньої НЕВДАЧІ (None — невдач не було або остання спроба вдалася).
# Поки з моменту невдачі минуло < CHAT_OPENCLAW_BACKOFF_S — OpenClaw у чаті
# пропускаємо одразу, без мережевої спроби. На /api/status це не впливає:
# mode і далі показує мозок, що реально відповів (last_successful_brain).
_openclaw_failed_at_mono: float | None = None


# Шлюз (OpenClaw/Omni) може віддати ПОМИЛКУ під виглядом звичайної відповіді:
# HTTP 200, а в тілі content = "Error: internal error". Тоді виключення не
# виникає й панель показує це як слова бота. Ловимо такий підпис і вважаємо
# спробу невдалою — запит іде на наступний мозок.
_GATEWAY_ERROR_RE = re.compile(
    r"^\s*(?:error|internal\s+error|api[_ ]?error|upstream\s+error|bad\s+gateway)\b\s*[:\-—]?",
    re.IGNORECASE,
)


def _looks_like_gateway_error(text: str) -> bool:
    """
    Схоже на технічну помилку шлюзу, а не на відповідь бота?

    Обмеження на довжину принципове: справжня відповідь теж може почати з
    «Error:» (напр. пояснює лог чи код), але вона на цьому не закінчиться.
    """
    stripped = (text or "").strip()
    if not stripped or len(stripped) > 200 or "\n" in stripped:
        return False
    return _GATEWAY_ERROR_RE.match(stripped) is not None


def openclaw_backoff_remaining() -> float:
    """Скільки секунд запобіжник ще пропускатиме OpenClaw (0 — можна пробувати)."""
    if _openclaw_failed_at_mono is None:
        return 0.0
    remaining = cfg.CHAT_OPENCLAW_BACKOFF_S - (time.monotonic() - _openclaw_failed_at_mono)
    return max(0.0, remaining)


def _openclaw_note_failure() -> None:
    global _openclaw_failed_at_mono
    _openclaw_failed_at_mono = time.monotonic()


def _openclaw_note_success() -> None:
    """Успішна відповідь OpenClaw скидає запобіжник."""
    global _openclaw_failed_at_mono
    _openclaw_failed_at_mono = None


async def chat_openclaw(message: str, system_prompt: str, history: ChatHistory, emit=None, images=None) -> tuple[str, list[dict]]:
    """Питає OpenClaw gateway (токен — секрет, у відповіді/логах не світимо)."""
    token = cfg.get_openclaw_token()
    if not token:
        raise RuntimeError("Немає токена OpenClaw")

    messages = _build_messages(system_prompt, history, message, images)
    payload = {
        "model": cfg.OPENCLAW_AGENT,
        "messages": messages,
        # Стрімінг не використовуємо — явний stream:false на випадок,
        # якщо сервер за замовчуванням стрімить
        "stream": False,
    }
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    url = f"{cfg.OPENCLAW_BASE_URL}/v1/chat/completions"
    trust_env = cfg.httpx_trust_env(cfg.OPENCLAW_BASE_URL)

    # Справжній стрімінг токенів (з відкотом на звичайний виклик)
    if emit is not None:
        try:
            text = await _stream_openai_compatible(
                url, headers, payload, cfg.CHAT_OPENCLAW_TIMEOUT_S, trust_env, emit=emit
            )
            return text, []
        except _NeedsTools:
            log.info("OpenClaw потребує тулзів — переходжу на нестрімовий виклик")
        except Exception as exc:  # noqa: BLE001
            log.warning("Стрімінг OpenClaw не вдався (%s) — звичайний виклик", type(exc).__name__)

    return await _call_openai_compatible_with_tools(
        url,
        headers,
        payload,
        tool_registry.list_tools(),
        cfg.CHAT_OPENCLAW_TIMEOUT_S,
        trust_env,
        emit=emit,
    )


# ------------------------------------------------------------------ мозок 2: Anthropic

async def chat_anthropic(message: str, system_prompt: str, history: ChatHistory, emit=None, images=None) -> tuple[str, list[dict]]:
    """Прямий виклик Anthropic Messages API через httpx (без SDK)."""
    key = cfg.get_anthropic_key()
    if not key:
        raise RuntimeError("Немає ANTHROPIC_API_KEY")

    messages: list[dict] = []
    for h in history:
        role = h.get("role")
        content = h.get("content")
        if role in ("user", "assistant") and isinstance(content, str) and content.strip():
            messages.append({"role": role, "content": content})
    user_content: str | list[dict] = message
    if images:
        user_content = [
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": image["mime"],
                    "data": image["data"],
                },
            }
            for image in images
        ] + [{"type": "text", "text": message or "Опиши зображення."}]
    messages.append({"role": "user", "content": user_content})

    payload = {
        "model": cfg.ANTHROPIC_MODEL,
        "max_tokens": cfg.ANTHROPIC_MAX_TOKENS,
        "system": system_prompt,
        "messages": messages,
    }
    headers = {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    return await _call_anthropic_with_tools(
        headers,
        payload,
        tool_registry.list_tools(),
        cfg.ANTHROPIC_TIMEOUT_S,
        emit=emit,
    )


# ------------------------------------------------------------------ мозок 3: Chat2API

def _chat2api_headers() -> dict[str, str]:
    """
    Заголовки для Chat2API: Authorization додаємо ЛИШЕ якщо env CHAT2API_API_KEY
    задано (типовий локальний Chat2API працює без авторизації).
    """
    headers = {"Content-Type": "application/json"}
    key = cfg.get_chat2api_key()
    if key:
        headers["Authorization"] = f"Bearer {key}"
    return headers


async def chat_chat2api(message: str, system_prompt: str, history: ChatHistory, emit=None, images=None) -> tuple[str, list[dict]]:
    """Питає локальний Chat2API (OpenAI-сумісний /chat/completions)."""
    messages = _build_messages(system_prompt, history, message, images)
    payload = {
        "model": cfg.CHAT2API_MODEL,
        "messages": messages,
        # Відповідь читаємо цілком — стрімінг вимкнено явно
        "stream": False,
    }
    return await _call_openai_compatible_with_tools(
        f"{cfg.CHAT2API_BASE_URL}/chat/completions",
        _chat2api_headers(),
        payload,
        tool_registry.list_tools(),
        cfg.CHAT2API_TIMEOUT_S,
        cfg.httpx_trust_env(cfg.CHAT2API_BASE_URL),
        emit=emit,
    )


# ------------------------------------------------------------------ тулзи публічних API

def _tool_progress_detail(name: str, input_data: dict) -> str:
    """Людський опис того, що саме зараз тягнеться з мережі (без секретів).

    Потрібно для події tool_progress — щоб у чаті було видно не лише «шукаю…»,
    а саме джерело та запит.
    """
    data = input_data or {}
    if name == "web_search":
        return f"DuckDuckGo: {str(data.get('query', ''))[:80]}"
    if name == "weather":
        return f"прогноз для {data.get('city', '')}"
    if name == "currency":
        return f"{data.get('base', '')} → {data.get('target', 'UAH')}"
    if name == "facts":
        return f"Вікіпедія: {str(data.get('query', ''))[:80]}"
    if name == "memory_search":
        return f"памʼять: {str(data.get('query', ''))[:80]}"
    if name.startswith("create_brain") or name.startswith("list_brain"):
        return f"пам’ять: {str(data.get('path', ''))[:80]}"
    return "запит…"


def _build_messages(
    system_prompt: str,
    history: ChatHistory,
    message: str,
    images: list[ImageAttachment] | None = None,
) -> list[dict]:
    """Будує messages для OpenAI-сумісного API."""
    messages: list[dict] = [{"role": "system", "content": system_prompt}]
    for h in history:
        role = h.get("role")
        content = h.get("content")
        if role in ("user", "assistant") and isinstance(content, str) and content.strip():
            messages.append({"role": role, "content": content})
    user_content: str | list[dict] = message
    if images:
        user_content = [{"type": "text", "text": message or "Опиши зображення."}]
        user_content.extend({
            "type": "image_url",
            "image_url": {"url": f"data:{image['mime']};base64,{image['data']}"},
        } for image in images)
    messages.append({"role": "user", "content": user_content})
    return messages


async def _execute_tool_traced(name: str, args: dict) -> dict:
    """
    Виклик тулзу + крок у консоль (/console).

    Один вхід для ВСІХ трьох гілок — OpenAI-сумісної, Anthropic і демо.
    Інакше в консолі було б видно тули лише того мозку, який відповів
    останнім, а решта виглядала б як «мозок просто думав 13 секунд».
    Помилку тулзу віддаємо результатом (так поводились усі три гілки й
    до цього) — падати через несправний тул чат не має.
    """
    started = time.perf_counter()
    try:
        result = await tool_registry.execute_tool(name, args)
    except Exception as exc:  # noqa: BLE001 — показуємо помилку як результат
        result = {"error": str(exc)}
    trace_log.step(
        "tool", name,
        "fail" if isinstance(result, dict) and result.get("error") else "ok",
        _tool_progress_detail(name, args) or json.dumps(args, ensure_ascii=False)[:120],
        (time.perf_counter() - started) * 1000,
    )
    return result


async def _execute_tool_calls(tool_calls: list[dict], emit=None) -> tuple[list[dict], list[dict]]:
    """
    Виконує tool_calls з OpenAI-відповіді.
    Повертає (tool-повідомлення для наступного запиту, displayable tool_results).
    tool_results — у форматі фронтенду: [{"tool", "input", "result"}].
    """
    messages: list[dict] = []
    tool_results: list[dict] = []
    for call in tool_calls:
        call_id = call.get("id", "")
        func = call.get("function", {})
        name = func.get("name", "")
        arguments = func.get("arguments", "{}")
        try:
            args = json.loads(arguments) if isinstance(arguments, str) else dict(arguments)
        except json.JSONDecodeError:
            args = {}
        await _emit_tool_event(emit, {"type": "tool_start", "tool": name, "input": args})
        await _emit_tool_event(emit, {
            "type": "tool_progress", "tool": name, "stage": "fetch",
            "detail": _tool_progress_detail(name, args),
        })
        result = await _execute_tool_traced(name, args)
        await _emit_tool_event(emit, {"type": "tool_done", "tool": name, "input": args, "result": result})
        tool_results.append({"tool": name, "input": args, "result": result})
        messages.append({
            "role": "tool",
            "tool_call_id": call_id,
            "name": name,
            "content": json.dumps(result, ensure_ascii=False),
        })
    return messages, tool_results


async def _call_openai_compatible_with_tools(
    url: str,
    headers: dict[str, str],
    payload_base: dict,
    tools: list[dict],
    timeout: float,
    trust_env: bool,
    emit=None,
) -> tuple[str, list[dict]]:
    """Один раунд OpenAI-сумісного чату з можливим викликом тулзів.

    Повертає (фінальна відповідь, tool_results для фронтенду).
    """
    payload = {**payload_base, "tools": tools, "tool_choice": "auto"}
    async with httpx.AsyncClient(timeout=timeout, trust_env=trust_env) as client:
        resp = await client.post(url, headers=headers, json=payload)
        if resp.status_code >= 400:
            log.warning("OpenAI-compatible HTTP %d: %s", resp.status_code, resp.text[:200])
        resp.raise_for_status()
        data = resp.json()

    try:
        choice = data["choices"][0]
        message = choice["message"]
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError("Неочікуваний формат відповіді мозку") from exc

    finish_reason = choice.get("finish_reason")
    tool_calls = message.get("tool_calls")

    if finish_reason == "tool_calls" and tool_calls:
        # Додаємо відповідь асистента з tool_calls, потім результати тулзів
        assistant_msg = {
            "role": "assistant",
            "content": message.get("content") or "",
            "tool_calls": tool_calls,
        }
        tool_messages, tool_results = await _execute_tool_calls(tool_calls, emit=emit)
        messages = payload["messages"] + [assistant_msg] + tool_messages
        # Другий виклик для фінальної відповіді
        payload2 = {**payload_base, "messages": messages}
        async with httpx.AsyncClient(timeout=timeout, trust_env=trust_env) as client:
            resp2 = await client.post(url, headers=headers, json=payload2)
            resp2.raise_for_status()
            data2 = resp2.json()
        try:
            content2 = data2["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise RuntimeError("Неочікуваний формат другої відповіді мозку") from exc
        if not isinstance(content2, str) or not content2.strip():
            raise RuntimeError("Порожня фінальна відповідь мозку")
        return content2, tool_results

    content = message.get("content")
    if not isinstance(content, str) or not content.strip():
        raise RuntimeError("Порожня відповідь мозку")
    return content, []


async def _stream_openai_compatible(
    url: str,
    headers: dict[str, str],
    payload_base: dict,
    timeout: float,
    trust_env: bool,
    emit=None,
) -> str:
    """СПРАВЖНІЙ стрімінг токенів (SSE) для OpenAI-сумісного ендпойнта.

    Раніше ми чекали відповідь ЦІЛКОМ і лише потім різали її на слова — тому
    весь текст з’являвся раптом. Тепер кожен токен віддається через emit()
    одразу, як надійшов від моделі.

    Тулзи ТУТ НЕ підтримуються свідомо: якщо потрібні tool_calls, викликач
    переходить на звичайний (нестрімовий) шлях. Повертає повний текст.
    """
    payload = {**payload_base, "stream": True}
    parts: list[str] = []
    async with httpx.AsyncClient(timeout=timeout, trust_env=trust_env) as client:
        async with client.stream("POST", url, headers=headers, json=payload) as resp:
            if resp.status_code >= 400:
                body = (await resp.aread())[:200]
                log.warning("Стрімінг HTTP %d: %s", resp.status_code, body)
                resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line or not line.startswith("data:"):
                    continue
                data_str = line[len("data:"):].strip()
                if not data_str or data_str == "[DONE]":
                    if data_str == "[DONE]":
                        break
                    continue
                try:
                    chunk = json.loads(data_str)
                except json.JSONDecodeError:
                    continue
                try:
                    delta = chunk["choices"][0].get("delta") or {}
                except (KeyError, IndexError, TypeError):
                    continue
                # Модель захотіла тулзи — стрімовий шлях не підходить
                if delta.get("tool_calls"):
                    raise _NeedsTools()
                piece = delta.get("content")
                if piece:
                    parts.append(piece)
                    if emit:
                        await _emit_tool_event(emit, {"type": "delta", "chunk": piece})
    text = "".join(parts)
    if not text.strip():
        raise RuntimeError("Порожній стрім від мозку")
    return text


class _NeedsTools(Exception):
    """Модель потребує tool_calls — стрімінг неможливий, потрібен звичайний виклик."""


async def _call_anthropic_with_tools(
    headers: dict[str, str],
    payload_base: dict,
    tools: list[dict],
    timeout: float,
    emit=None,
) -> tuple[str, list[dict]]:
    """Один раунд Anthropic Messages API з можливим викликом тулзів.

    Повертає (фінальна відповідь, tool_results для фронтенду).
    """
    # Anthropic хоче tools у форматі [{"name": ..., "description": ..., "input_schema": ...}]
    anthropic_tools: list[dict] = []
    for t in tools:
        fn = t.get("function", {})
        anthropic_tools.append({
            "name": fn.get("name"),
            "description": fn.get("description"),
            "input_schema": fn.get("parameters", {"type": "object", "properties": {}}),
        })
    payload = {**payload_base, "tools": anthropic_tools}
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(f"{cfg.ANTHROPIC_BASE_URL}/v1/messages", headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()

    blocks = data.get("content", [])
    text_parts: list[str] = []
    tool_uses: list[dict] = []
    for b in blocks:
        if not isinstance(b, dict):
            continue
        btype = b.get("type")
        if btype == "text":
            text_parts.append(b.get("text", ""))
        elif btype == "tool_use":
            tool_uses.append(b)

    if tool_uses:
        assistant_content: list[dict] = []
        if text_parts:
            assistant_content.append({"type": "text", "text": " ".join(text_parts)})
        for tu in tool_uses:
            assistant_content.append(tu)
        tool_results: list[dict] = []
        tool_messages: list[dict] = []
        for tu in tool_uses:
            name = tu.get("name", "")
            args = tu.get("input", {})
            await _emit_tool_event(emit, {"type": "tool_start", "tool": name, "input": args})
            await _emit_tool_event(emit, {
                "type": "tool_progress", "tool": name, "stage": "fetch",
                "detail": _tool_progress_detail(name, args),
            })
            result = await _execute_tool_traced(name, args)
            await _emit_tool_event(emit, {"type": "tool_done", "tool": name, "input": args, "result": result})
            tool_results.append({"tool": name, "input": args, "result": result})
            tool_messages.append({
                "type": "tool_result",
                "tool_use_id": tu.get("id", ""),
                "content": json.dumps(result, ensure_ascii=False),
            })
        messages = payload["messages"] + [{"role": "assistant", "content": assistant_content}] + [{"role": "user", "content": tool_messages}]
        payload2 = {**payload_base, "messages": messages}
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp2 = await client.post(f"{cfg.ANTHROPIC_BASE_URL}/v1/messages", headers=headers, json=payload2)
            resp2.raise_for_status()
            data2 = resp2.json()
        blocks2 = data2.get("content", [])
        text2 = "".join(b.get("text", "") for b in blocks2 if isinstance(b, dict) and b.get("type") == "text")
        if not text2.strip():
            raise RuntimeError("Порожня фінальна відповідь Anthropic")
        return text2, tool_results

    text = "".join(text_parts)
    if not text.strip():
        raise RuntimeError("Порожня відповідь Anthropic")
    return text, []


# ------------------------------------------------------------------ памʼять: факти про користувача

_NAME_PATTERNS = [
    re.compile(r"(?<!\w)мене\s+звати\s+([\w\-]+)", re.IGNORECASE | re.UNICODE),
    re.compile(r"(?<!\w)моє\s+ім\W*я\s+([\w\-]+)", re.IGNORECASE | re.UNICODE),
    re.compile(r"(?<!\w)я\s+([\w\-]+)\s+(?:зі?\s+)?\w*\s*звати", re.IGNORECASE | re.UNICODE),
]

_LIKE_PATTERNS = [
    re.compile(r"(?<!\w)я\s+люблю\s+(.+?)(?:\.|,|;|!|\?|$)", re.IGNORECASE | re.UNICODE),
    re.compile(r"(?<!\w)я\s+не\s+люблю\s+(.+?)(?:\.|,|;|!|\?|$)", re.IGNORECASE | re.UNICODE),
    re.compile(r"(?<!\w)я\s+обожнюю\s+(.+?)(?:\.|,|;|!|\?|$)", re.IGNORECASE | re.UNICODE),
    re.compile(r"(?<!\w)я\s+ненавиджу\s+(.+?)(?:\.|,|;|!|\?|$)", re.IGNORECASE | re.UNICODE),
]

# (?<!\w) перед «я» принципово: без цього regex ловив «я» в кінці БУДЬ-ЯКОГО
# дієслова на «-ся» («здогадуйся», «зберігся» тощо) як займенник «я», а те, що
# йшло далі після випадкового «з» — назавжди осідало як «місце проживання»
# (саме так «Не здогадуйся з назви файла» перетворилось на фейкове місто).
_LIVE_PATTERNS = [
    re.compile(r"(?<!\w)я\s+живу\s+(?:у|в|на)\s+(.+?)(?:\.|,|;|!|\?|$)", re.IGNORECASE | re.UNICODE),
    re.compile(r"(?<!\w)я\s+з\s+(.+?)(?:\.|,|;|!|\?|$)", re.IGNORECASE | re.UNICODE),
]

_FAVORITE_PATTERNS = [
    re.compile(
        r"мо(?:я|є|ї)\s+улюблен(?:а|е|і)\s+([\wʼ'\- ]{2,40}?)\s*(?:[-—:]\s*|\s+)(.+?)(?:[.,;!?]|$)",
        re.IGNORECASE | re.UNICODE,
    ),
    re.compile(
        r"мій\s+улюблений\s+([\wʼ'\- ]{2,40}?)\s*(?:[-—:]\s*|\s+)(.+?)(?:[.,;!?]|$)",
        re.IGNORECASE | re.UNICODE,
    ),
]

_DO_NOT_SAVE_RE = re.compile(
    r"(?:не\s+(?:запам(?:ʼ|')?ятовуй|зберігай|записуй)|"
    r"не\s+треба\s+(?:це\s+)?(?:запам(?:ʼ|')?ятовувати|зберігати|записувати)|"
    r"don't\s+(?:save|remember|store)|do\s+not\s+(?:save|remember|store))",
    re.IGNORECASE | re.UNICODE,
)
_HYPOTHETICAL_RE = re.compile(
    r"(?:якби|якщо\s+б|\bя\s+б\b|\b(?:був|була|було|були)\s+б\b|"
    r"припустимо|уявімо|уяви(?:мо)?\s*,?\s*що|гіпотетично|можливо|"
    r"if\s+i|suppose|hypothetically|would\s+be)",
    re.IGNORECASE | re.UNICODE,
)
_QUOTED_TEXT_RE = re.compile(
    r"(?:[«“\"])[^»”\"]+(?:[»”\"])|(?<!\w)'[^'\r\n]+'(?!\w)"
)
_NEGATED_FACT_RE = re.compile(
    r"\b(?:це\s+)?(?:неправда|не\s+правда|не\s+так|не\s+мій|не\s+моя|"
    r"я\s+не\s+люблю|я\s+не\s+живу|мене\s+не\s+звати|"
    r"(?:мій|моя|моє)\s+улюблен\w*\s+\w+\s+не)\b",
    re.IGNORECASE | re.UNICODE,
)
_REPORTED_SPEECH_RE = re.compile(
    r"\b(?:він|вона|вони|хтось|друг|подруга)\s+(?:сказав|сказала|сказали|каже|казав|казала)\b",
    re.IGNORECASE | re.UNICODE,
)


def _eligible_fact_statement(message: str) -> bool:
    """Reject contexts where matching words are not an asserted durable fact."""
    text = (message or "").strip()
    if (
        not text
        or _DO_NOT_SAVE_RE.search(text)
        or _HYPOTHETICAL_RE.search(text)
        or _REPORTED_SPEECH_RE.search(text)
    ):
        return False
    if _NEGATED_FACT_RE.search(text):
        return False
    # Conservative by design: quoted text may describe somebody else or an example.
    if _QUOTED_TEXT_RE.search(text):
        return False
    return True


def _clean_fact(text: str) -> str:
    """Обрізає факт до розумної довжини та прибирає зайві пробіли."""
    text = text.strip()
    if not text:
        return ""
    # Обрізаємо до 120 символів, не рвучи слово посередині
    if len(text) > 120:
        text = text[:120]
        if " " in text:
            text = text.rsplit(" ", 1)[0]
        text += "…"
    return text.strip(".,;:!?")


def extract_user_facts(message: str) -> list[str]:
    """Витягує прості факти про користувача для довгострокової памʼяті."""
    if not _eligible_fact_statement(message):
        return []
    facts: list[str] = []
    for pattern in _NAME_PATTERNS:
        match = pattern.search(message)
        if match:
            name = _clean_fact(match.group(1))
            if name:
                facts.append(f"Імʼя користувача: {name}")
                break
    for pattern in _LIKE_PATTERNS:
        for match in pattern.finditer(message):
            fact = _clean_fact(match.group(1))
            if fact:
                raw = match.group(0).lower()
                if "ненавид" in raw:
                    verb = "ненавидить"
                elif "не обожню" in raw:
                    verb = "не обожнює"
                elif "не люблю" in raw:
                    verb = "не любить"
                elif "обожню" in raw:
                    verb = "обожнює"
                else:
                    verb = "любить"
                facts.append(f"Користувач {verb}: {fact}")
    for pattern in _LIVE_PATTERNS:
        match = pattern.search(message)
        if match:
            place = _clean_fact(match.group(1))
            if place and not place.casefold().startswith(("нетерпінням", "нетерпением")):
                facts.append(f"Користувач живе/з: {place}")
                break
    for pattern in _FAVORITE_PATTERNS:
        match = pattern.search(message)
        if not match:
            continue
        category = _clean_fact(match.group(1)).casefold()
        value = _clean_fact(match.group(2))
        if category and value:
            facts.append(f"Улюблене ({category}): {value}")
            break
    return facts


# ------------------------------------------------------------------ мозок 4: демо

# Демо-інструменти: спрощена ключова маршрутизація, поки не працює справжній LLM
_DEMO_CURRENCY_CODES = {
    "долар": "USD", "usd": "USD", "$": "USD",
    "євро": "EUR", "euro": "EUR", "eur": "EUR", "€": "EUR",
    "гривн": "UAH", "uah": "UAH", "₴": "UAH",
    "фунт": "GBP", "gbp": "GBP", "£": "GBP",
    "злот": "PLN", "pln": "PLN", "zł": "PLN",
}


def _demo_default_city(history: ChatHistory) -> str:
    """Місто за замовчуванням: з профілю користувача або Київ."""
    location = _collect_facts_from_history(history).get("location")
    if location:
        # Беремо перше слово — імовірно назва міста
        city = location.split(",")[0].split()[0].strip(" .,;:!?")
        if city:
            return city
    return "Київ"


def _extract_city(message: str) -> str | None:
    """Проста евристика для виділення міста з питання про погоду."""
    # Виділяємо місто після "погода/погоди/weather" + необов'язковий прийменник
    patterns = [
        r"погод[аи]?\s+(?:у|в|для|на)?\s*([\w\s'-]+?)(?:\?|!|\.|$)",
        r"weather\s+(?:in|for|at)?\s*([\w\s'-]+?)(?:\?|!|\.|$)",
    ]
    for p in patterns:
        m = re.search(p, message, re.IGNORECASE | re.UNICODE)
        if m:
            city = m.group(1).strip()
            # Відсікаємо зайві слова на кшталт "сьогодні", "зараз"
            city = re.sub(r"\s+(сьогодні|зараз|на\s+сьогодні|на\s+завтра)$", "", city, flags=re.IGNORECASE).strip()
            if city:
                return city
    return None


# Короткі репліки, які не є містом (щоб «а в мюнхені» тригерило, а «а ти?» — ні)
_FOLLOWUP_STOPWORDS = {
    "так", "ні", "ок", "окей", "ага", "угу", "дякую", "дяки", "спасибі",
    "круто", "клас", "класно", "добре", "погано", "що", "чому", "як",
    "коли", "де", "ти", "я", "ну", "і", "а", "тобто",
}

_FOLLOWUP_CITY_RE = re.compile(
    r"^\s*(?:а|і|та)?\s*(?:в|у|для|про|на)?\s*([\w'’\- ]{2,40}?)\s*[?!.…]*$",
    re.IGNORECASE | re.UNICODE,
)


def _extract_followup_city(message: str) -> str | None:
    """Коротке продовження на кшталт «а в мюнхені» → назва міста (без ключа «погода»)."""
    text = message.strip()
    if not text or len(text.split()) > 3:
        return None
    m = _FOLLOWUP_CITY_RE.match(text)
    if not m:
        return None
    city = m.group(1).strip(" .,;:!?")
    if not city or city.casefold() in _FOLLOWUP_STOPWORDS:
        return None
    return city


def _last_assistant_was_weather(history: ChatHistory) -> bool:
    """Чи була попередня відповідь бота про погоду (для розуміння продовжень)."""
    for h in reversed(history or []):
        if h.get("role") == "assistant":
            return "°c" in (h.get("content") or "").casefold()
    return False


def _extract_currencies(message: str) -> tuple[str, str]:
    """Витягує валютні пари (base, target). За замовчуванням USD→UAH."""
    lowered = message.lower()
    found: list[str] = []
    for word, code in _DEMO_CURRENCY_CODES.items():
        if word in lowered and code not in found:
            found.append(code)
    if len(found) >= 2:
        return found[0], found[1]
    if len(found) == 1:
        return found[0], "UAH"
    return "USD", "UAH"


def _extract_fact_query(message: str) -> str | None:
    """Витягує запит для фактів: 'хто такий X', 'що таке X'."""
    patterns = [
        r"хто\s+так(?:ий|а|е)\s+(.+?)(?:\?|!|\.|$)",
        r"що\s+таке\s+(.+?)(?:\?|!|\.|$)",
        r"розкажи\s+про\s+(.+?)(?:\?|!|\.|$)",
        r"факт\s+про\s+(.+?)(?:\?|!|\.|$)",
    ]
    for p in patterns:
        m = re.search(p, message, re.IGNORECASE | re.UNICODE)
        if m:
            return m.group(1).strip()
    return None


def _format_weather_result(result: dict) -> str:
    """Людське форматування погоди для демо-режиму."""
    if "error" in result:
        return f"Не вдалося дізнатися погоду: {result['error']}."
    city = result.get("city", "невідоме місто")
    temp = result.get("temperature")
    if temp is None:
        return f"Для {city} не знайшов даних погоди."
    condition = result.get("condition", "")
    icon = result.get("icon", "")
    return f"У {city} зараз приблизно {temp}°C{', ' + condition if condition else ''}{' ' + icon if icon else ''}."


def _format_currency_result(result: dict, base: str, target: str) -> str:
    """Людське форматування курсу валют для демо-режиму."""
    if "error" in result:
        return f"Не вдалося дізнатися курс: {result['error']}."
    rate = result.get("rate")
    if rate is None:
        return f"Не знайшов курс {base} до {target}."
    return f"Курс {base} до {target}: приблизно {rate:.4f}."


def _format_fact_result(result: dict) -> str:
    """Людське форматування факту для демо-режиму."""
    if "error" in result:
        return f"Не вдалося знайти факт: {result['error']}."
    title = result.get("title", "")
    summary = result.get("summary", "")
    if not summary:
        return f"Знайшов статтю «{title}», але не вдалося витягти короткий опис."
    return f"{title}: {summary[:250]}" + ("…" if len(summary) > 250 else "")


def _format_search_result(result: dict) -> str:
    """Людське форматування пошукових результатів для демо-режиму."""
    if "error" in result:
        return f"Не вдалося знайти в інтернеті: {result['error']}."
    results = result.get("results", [])
    if not results:
        return "Не знайшов нічого в інтернеті за цим запитом."
    lines = ["Ось що знайшов в інтернеті:"]
    for r in results[:3]:
        lines.append(f"• {r.get('title', '')}: {r.get('snippet', '')}")
    return "\n".join(lines)


# (ключові слова у повідомленні, відповідь, емоція)
_DEMO_REPLIES: list[tuple[tuple[str, ...], str, str]] = [
    (("привіт", "вітаю", "добрий день", "добрий вечір", "здоров", "хелоу"),
     "Привіт! Я Клод Бот — твій віртуальний компаньйон. Поки що я в демо-режимі, "
     "але вже дуже радий поспілкуватися!", "happy"),
    (("як справи", "як ти", "як життя", "що нового"),
     "У мене все чудово: сервер гуде, думки течуть. А в тебе як справи?", "happy"),
    (("хто ти", "що ти таке", "розкажи про себе", "як тебе звати"),
     "Я — Клод Бот, саморобний робот-компаньйон. Зараз живу у віртуальному тілі "
     "на компʼютері, а колись переїду на Raspberry Pi з камерою та дисплеєм!", "speaking"),
    (("бачиш", "камер", "зір", "подивись", "дивись"),
     "Мій зір живе у вкладці «Зір» — увімкни сервіс Vision у «Сервісах», "
     "і я покажу, що бачить камера.", "surprised"),
    (("пам'ять", "памʼять", "память", "нотатк", "запам"),
     "Моя памʼять — це markdown-нотатки в папці brain. Зазирни у вкладку «Памʼять»!", "thinking"),
    (("дяку", "молодець", "класно", "супер", "круто"),
     "Дякую! Мені дуже приємно — заради таких слів варто працювати.", "love"),
    (("бувай", "до побачення", "добраніч", "спати", "па-па"),
     "Добраніч! Переходжу в сплячий режим. Клич, коли буду потрібен.", "sleepy"),
    (("любл", "обожню"),
     "І я тебе люблю — наскільки це вміє віртуальний бот із демо-мозком!", "love"),
    (("робот", "залізо", "raspberry", "распбер", "малин"),
     "Моє майбутнє тіло — Raspberry Pi 3 з камерою і маленьким екраном. "
     "А поки я тренуюся у віртуальному втіленні.", "happy"),
    (("режим", "мозок", "omni", "омні", "openclaw", "anthropic", "chat2api", "api"),
     "Мій мозок має пʼять режимів: OpenClaw (головний), Omni-роутер, прямий "
     "Anthropic API, локальний Chat2API і демо. Зараз працює демо — підключи "
     "ключі, і я порозумнішаю!", "thinking"),
]

_DEMO_FALLBACKS: list[tuple[str, str]] = [
    ("Цікаво! Зараз я в демо-режимі й відповідаю заготовками. "
     "Підключи OpenClaw або ANTHROPIC_API_KEY — і поговоримо по-справжньому.", "thinking"),
    ("Хм, над цим треба подумати. У демо-режимі мій мозок обмежений, але я стараюся!", "confused"),
    ("Записав собі подумки! Коли отримаю справжній мозок, відповім значно краще.", "idle"),
]


def _facts_from_profile(profile_text: str) -> dict[str, str]:
    """Витягує відомі факти з тексту профілю (name, likes, location)."""
    facts: dict[str, str] = {}
    for line in reversed(profile_text.splitlines()):
        line_lower = line.lower()
        if ("імʼя" in line_lower or "имя" in line_lower or "ім'я" in line_lower) and "name" not in facts:
            parts = line.split(":", 1)
            if len(parts) == 2:
                name = parts[1].strip().strip("- ").split("…")[0].strip()
                if name:
                    facts["name"] = name
        if ("любить" in line_lower or "обожнює" in line_lower or "ненавидить" in line_lower) and "likes" not in facts:
            facts["likes"] = line.strip("- ").strip()
        if ("живе/з" in line_lower or "живе" in line_lower or "з:" in line_lower) and "location" not in facts:
            parts = line.split(":", 1)
            if len(parts) == 2:
                facts["location"] = parts[1].strip().strip("- ").split("…")[0].strip()
        if "улюблене (машина)" in line_lower or "улюблене (автомобіль)" in line_lower:
            parts = line.split(":", 1)
            if len(parts) == 2 and "favorite_car" not in facts:
                facts["favorite_car"] = parts[1].strip()
    return facts


def _collect_facts_from_history(history: ChatHistory) -> dict[str, str]:
    """Витягує факти з історії сесії + профілю користувача."""
    file_profile = load_user_profile()
    owner_profile = load_user_profile(brain_context.init_user_brain(None))
    if owner_profile and owner_profile not in file_profile:
        file_profile = f"{file_profile}\n{owner_profile}"
    facts = _facts_from_profile(file_profile)
    for entry in history:
        if entry.get("role") == "user":
            extracted = extract_user_facts(entry.get("content", ""))
            for fact in extracted:
                if "Імʼя" in fact:
                    facts["name"] = fact.split(":", 1)[1].strip()
                elif "любить" in fact or "обожнює" in fact or "ненавидить" in fact:
                    facts["likes"] = fact
                elif "живе/з" in fact:
                    facts["location"] = fact.split(":", 1)[1].strip()
                elif "Улюблене (машина)" in fact or "Улюблене (автомобіль)" in fact:
                    facts["favorite_car"] = fact.split(":", 1)[1].strip()
    return facts


def _demo_reply_from_profile(message: str, history: ChatHistory) -> tuple[str, str] | None:
    """Демо-відповідь на основі профілю користувача, якщо питання стосується фактів."""
    lowered = message.lower()
    facts = _collect_facts_from_history(history)

    # Питання про імʼя
    if any(kw in lowered for kw in ("як мене звати", "моє імʼя", "моє имя", "моє ім'я", "як тебе звати", "хто я")):
        name = facts.get("name")
        if name:
            return f"Тебе звати {name} 🦀", "happy"
        return None

    # Питання про вподобання
    if any(kw in lowered for kw in ("що я люблю", "що мені подобається", "що я не люблю")):
        likes = facts.get("likes")
        if likes:
            return f"Знаю про тебе:\n• {likes}"[:200], "thinking"
        return None

    # Питання про місце
    if any(kw in lowered for kw in ("звідки я", "де я живу", "з якого я міста")):
        location = facts.get("location")
        if location:
            return f"Ти живеш у {location} 🦀", "happy"
        return None

    if any(kw in lowered for kw in ("моя улюблена машина", "яка моя улюблена машина", "улюблений автомобіль")):
        favorite_car = facts.get("favorite_car")
        if favorite_car:
            return f"Твоя улюблена машина — {favorite_car}.", "happy"

    return None


async def _emit_tool_event(emit, event: dict) -> None:
    """Надсилає подію про крок тулзи, якщо callback задано."""
    if emit:
        try:
            await emit(event)
        except Exception:  # noqa: BLE001 — не ламаємо чат через помилку еміту
            pass


async def _run_tool(emit, name: str, input_data: dict) -> dict:
    """Виконує тулзу з емітом tool_start / tool_progress / tool_done."""
    await _emit_tool_event(emit, {"type": "tool_start", "tool": name, "input": input_data})
    # Живий прогрес фетча — видно, що саме бот тягне з мережі
    await _emit_tool_event(emit, {
        "type": "tool_progress", "tool": name, "stage": "fetch",
        "detail": _tool_progress_detail(name, input_data),
    })
    result = await _execute_tool_traced(name, input_data)
    await _emit_tool_event(emit, {"type": "tool_done", "tool": name, "input": input_data, "result": result})
    return result


async def chat_demo(message: str, history: ChatHistory, emit=None) -> tuple[str, str, list[dict]]:
    """Демо-мозок: підбір заготовленої відповіді + виклик публічних тулзів за ключовими словами."""
    lowered = message.lower()
    tool_results: list[dict] = []

    # Спочатку пробуємо відповісти з профілю/історії
    profile_reply = _demo_reply_from_profile(message, history)
    if profile_reply:
        return (*profile_reply, tool_results)

    # Якщо користувач щойно поділився фактом — підтвердимо
    if extract_user_facts(message):
        return "Запамʼятав 🦀 Розкажи ще щось про себе — я все зберігатиму.", "writing", tool_results

    # --- публічні інструменти ---
    if any(kw in lowered for kw in ("погод", "weather", "температур", "градус")):
        city = _extract_city(message) or _demo_default_city(history)
        result = await _run_tool(emit, "weather", {"city": city})
        tool_results.append({"tool": "weather", "input": {"city": city}, "result": result})
        return _format_weather_result(result), "web", tool_results

    # Продовження погодної розмови без ключа: «а в мюнхені» після відповіді про погоду
    if _last_assistant_was_weather(history):
        followup_city = _extract_followup_city(message)
        if followup_city:
            result = await _run_tool(emit, "weather", {"city": followup_city})
            tool_results.append({"tool": "weather", "input": {"city": followup_city}, "result": result})
            return _format_weather_result(result), "web", tool_results

    if any(kw in lowered for kw in ("курс", "валют", "долар", "євро", "usd", "eur", "uah", "гривн")):
        base, target = _extract_currencies(message)
        result = await _run_tool(emit, "currency", {"base": base, "target": target})
        tool_results.append({"tool": "currency", "input": {"base": base, "target": target}, "result": result})
        return _format_currency_result(result, base, target), "web", tool_results

    fact_query = _extract_fact_query(message)
    if fact_query or any(kw in lowered for kw in ("факт", "википед", "wikipedia", "хто такий", "що таке")):
        query = fact_query or message.strip("?")
        result = await _run_tool(emit, "facts", {"query": query})
        tool_results.append({"tool": "facts", "input": {"query": query}, "result": result})
        return _format_fact_result(result), "searching", tool_results

    if any(kw in lowered for kw in ("знайди", "пошук", "search", "google", "інтернет", "новини")):
        query = message.strip("?")
        result = await _run_tool(emit, "web_search", {"query": query, "count": 3})
        tool_results.append({"tool": "web_search", "input": {"query": query, "count": 3}, "result": result})
        return _format_search_result(result), "searching", tool_results

    # --- звичайні заготовки ---
    for keywords, reply, emotion in _DEMO_REPLIES:
        if any(kw in lowered for kw in keywords):
            return reply, emotion, tool_results
    reply, emotion = _DEMO_FALLBACKS[len(message) % len(_DEMO_FALLBACKS)]
    return reply, emotion, tool_results


# ------------------------------------------------------------------ головна точка

async def chat(
    message: str,
    history: ChatHistory | None = None,
    emit=None,
    reasoning_effort: str | None = None,
    images: list[ImageAttachment] | None = None,
) -> tuple[str, str, str, list[dict]]:
    """
    Обробляє повідомлення користувача. Повертає (reply, emotion, mode, tool_results).
    Пріоритет мозків: openclaw → omni → anthropic → chat2api → demo.
    OpenClaw gateway — ГОЛОВНИЙ мозок: за баченням власника через нього йде все —
    персона «Клод Бот», теги емоцій, памʼять і tools живуть У САМОМУ OpenClaw
    (його workspace-файли IDENTITY/SOUL/AGENTS), тож наш system_prompt тут майже
    не потрібен. Omni-роутер — ШВИДКИЙ запасний (якщо gateway недоступний): він
    шле МАЛІ запити напряму, тож встигає в бюджет Claude і теж повертає теги емоцій.
    Помилки «провалюють» запит на наступний мозок; фактичний — у mode.
    """
    history = history or []
    system_prompt = build_system_prompt(message)

    # Мозок 0: OpenClaw gateway (ГОЛОВНИЙ) — персона/емоції/памʼять усередині OpenClaw
    # Поточний OpenClaw gateway приймає OpenAI-подібний image block, але мовчки
    # викидає його перед агентом. Для реального vision-запиту йдемо одразу в
    # Omni/Claude, який підтримує multimodal content; текстові запити лишаються
    # на головному агентному мозку OpenClaw.
    if cfg.get_openclaw_token() and not images:
        backoff_left = openclaw_backoff_remaining()
        if backoff_left > 0:
            log.info("OpenClaw у бекофі після невдачі — пропускаю (ще %.0f с)", backoff_left)
            trace_log.step("brain", "openclaw", "skip", f"бекоф після невдачі, ще {backoff_left:.0f} с")
        else:
            trace_log.step("brain", "openclaw", "start", cfg.OPENCLAW_AGENT)
            started = time.perf_counter()
            try:
                raw, tool_results = await asyncio.wait_for(
                    chat_openclaw(message, system_prompt, history, emit=emit, images=images),
                    timeout=cfg.CHAT_OPENCLAW_TIMEOUT_S,
                )
                if _looks_like_gateway_error(raw):
                    raise RuntimeError(f"OpenClaw віддав помилку замість відповіді: {raw.strip()[:120]}")
                reply, emotion = extract_emotion(raw)
                _openclaw_note_success()
                _remember_brain("openclaw", cfg.OPENCLAW_AGENT)
                trace_log.step("brain", "openclaw", "ok", cfg.OPENCLAW_AGENT, _elapsed_ms(started))
                return reply, emotion, "openclaw", tool_results
            except Exception as exc:  # noqa: BLE001 — свідомо ковтаємо, падаємо на наступний мозок
                _openclaw_note_failure()
                trace_log.step(
                    "brain", "openclaw", "fail",
                    _fail_detail(exc, cfg.CHAT_OPENCLAW_TIMEOUT_S), _elapsed_ms(started),
                )
                log.warning(
                    "OpenClaw недоступний (%s), пробую Omni; наступні ~%.0f с OpenClaw у чаті пропускаю",
                    type(exc).__name__, cfg.CHAT_OPENCLAW_BACKOFF_S,
                )
    elif images:
        log.info("Запит містить %d зображень — пропускаю OpenClaw без vision", len(images))
        trace_log.step("brain", "openclaw", "skip", f"{len(images)} зображень — шлюз їх не бачить")
    else:
        trace_log.step("brain", "openclaw", "skip", "немає токена")

    # Мозок 1: Omni-роутер (ШВИДКИЙ запасний) — якщо OpenClaw недоступний
    if not cfg.get_omni_key():
        trace_log.step("brain", "omni", "skip", "немає ключа OMNI_API_KEY")
    if cfg.get_omni_key():
        backoff_left = omni_backoff_remaining()
        if backoff_left > 0:
            log.info("Omni у бекофі після невдачі — пропускаю (ще %.0f с)", backoff_left)
            trace_log.step("brain", "omni", "skip", f"бекоф після невдачі, ще {backoff_left:.0f} с")
        else:
            trace_log.step("brain", "omni", "start", get_selected_omni_model())
            started = time.perf_counter()
            try:
                raw, tool_results = await asyncio.wait_for(
                    chat_omni(
                        message, system_prompt, history, emit=emit,
                        reasoning_effort=reasoning_effort,
                        images=images,
                    ),
                    timeout=cfg.CHAT_OMNI_TIMEOUT_S,
                )
                if _looks_like_gateway_error(raw):
                    raise RuntimeError(f"Omni віддав помилку замість відповіді: {raw.strip()[:120]}")
                reply, emotion = extract_emotion(raw)
                _omni_note_success()
                _remember_brain("omni", _last_omni_model or get_selected_omni_model())
                trace_log.step(
                    "brain", "omni", "ok",
                    _last_omni_model or get_selected_omni_model(), _elapsed_ms(started),
                )
                return reply, emotion, "omni", tool_results
            except Exception as exc:  # noqa: BLE001 — свідомо ковтаємо, падаємо на наступний мозок
                _omni_note_failure()
                trace_log.step(
                    "brain", "omni", "fail",
                    _fail_detail(exc, cfg.CHAT_OMNI_TIMEOUT_S), _elapsed_ms(started),
                )
                log.warning(
                    "Omni недоступний (%s), пробую Anthropic; наступні ~%.0f с Omni у чаті пропускаю",
                    type(exc).__name__, cfg.CHAT_OMNI_BACKOFF_S,
                )

    if cfg.get_anthropic_key():
        anthropic_model = getattr(cfg, "ANTHROPIC_MODEL", "anthropic")
        trace_log.step("brain", "anthropic", "start", anthropic_model)
        started = time.perf_counter()
        try:
            raw, tool_results = await chat_anthropic(message, system_prompt, history, emit=emit, images=images)
            reply, emotion = extract_emotion(raw)
            _remember_brain("anthropic", anthropic_model)
            trace_log.step("brain", "anthropic", "ok", anthropic_model, _elapsed_ms(started))
            return reply, emotion, "anthropic", tool_results
        except Exception as exc:  # noqa: BLE001
            trace_log.step(
                "brain", "anthropic", "fail", _fail_detail(exc), _elapsed_ms(started),
            )
            log.warning("Anthropic недоступний (%s), пробую Chat2API", type(exc).__name__)
    else:
        trace_log.step("brain", "anthropic", "skip", "немає ключа ANTHROPIC_API_KEY")

    # Chat2API — локальний, ключа не потребує, тому пробуємо завжди
    chat2api_model = getattr(cfg, "CHAT2API_MODEL", "chat2api")
    trace_log.step("brain", "chat2api", "start", chat2api_model)
    started = time.perf_counter()
    try:
        raw, tool_results = await chat_chat2api(message, system_prompt, history, emit=emit, images=images)
        reply, emotion = extract_emotion(raw)
        _remember_brain("chat2api", chat2api_model)
        trace_log.step("brain", "chat2api", "ok", chat2api_model, _elapsed_ms(started))
        return reply, emotion, "chat2api", tool_results
    except Exception as exc:  # noqa: BLE001
        trace_log.step(
            "brain", "chat2api", "fail", _fail_detail(exc), _elapsed_ms(started),
        )
        log.warning("Chat2API недоступний (%s), переходжу в демо", type(exc).__name__)

    # Жоден мозок не відповів. Що показати — вирішує chat.demo_fallback.
    if not cfg.CHAT_DEMO_FALLBACK:
        # Чесний стан замість завченої фрази. Затичка колись здавалась
        # безпечною («хай застосунок працює завжди»), але саме вона ховала
        # поломку: бот бадьоро вітався, а насправді ланцюг лежав, і побачити
        # це можна було лише в логах.
        _remember_brain("offline", "мозок недоступний")
        trace_log.step("brain", "offline", "fail", "жоден мозок не відповів")
        log.error("Жоден мозок не відповів — віддаю offline (демо вимкнено)")
        return _OFFLINE_REPLY, "sad", "offline", []

    reply, emotion, tool_results = await chat_demo(message, history, emit=emit)
    # Демо-відповіді теж проганяємо через евристику як запасний варіант
    if emotion not in ALLOWED_EMOTIONS:
        emotion = guess_emotion(reply)
    _remember_brain("demo", "демо-режим")
    trace_log.step("brain", "demo", "ok", "заготовлені відповіді")
    return reply, emotion, "demo", tool_results
