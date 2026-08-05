"""
«Клод Бот» — Virtual Bot: куровані MCP-сервери, пресети й скіли для майстра.

MCP додаються в OpenClaw через `openclaw mcp add <name> --command <cmd> --arg …`
(OpenClaw пробує зʼєднання перед збереженням — невірний пакет впаде безпечно).
Джерела: awesome-mcp-servers (wong2), mcp.so, офіційні @modelcontextprotocol/*,
@playwright/mcp, @cocal/google-calendar-mcp.
"""

from __future__ import annotations

from app_config import BASE_DIR

# id, name, desc(укр), category, command+args(stdio), env(ключі), needs_key,
# recommended(маст-хев), note
MCP_SUGGESTIONS: list[dict] = [
    {
        "id": "memory", "name": "Пам'ять (граф знань)",
        "desc": "Довготривала памʼять про людей і факти у вигляді графа знань.",
        "category": "Пам'ять", "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-memory"],
        "env": [], "needs_key": False, "recommended": True,
        "note": "Офіційний. Без ключа.",
    },
    {
        "id": "sequential-thinking", "name": "Покрокові міркування",
        "desc": "Розкладає складні задачі на кроки — глибші, структурованіші відповіді.",
        "category": "Мислення", "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"],
        "env": [], "needs_key": False, "recommended": True,
        "note": "Офіційний. Без ключа.",
    },
    {
        "id": "youtube", "name": "YouTube",
        "desc": "Транскрипти й пошук відео — бот «дивиться» ролик і переказує.",
        "category": "Медіа", "command": "npx",
        "args": ["-y", "@kimtaeyoon83/mcp-server-youtube-transcript"],
        "env": [], "needs_key": False, "recommended": True,
        "note": "Спільнотний (транскрипти).",
    },
    {
        "id": "brave-search", "name": "Веб-пошук (Brave)",
        "desc": "Пошук в інтернеті в реальному часі — новини, факти, сьогодення.",
        "category": "Знання", "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-brave-search"],
        "env": ["BRAVE_API_KEY"], "needs_key": True, "recommended": True,
        "note": "Безкоштовний ключ: brave.com/search/api.",
    },
    {
        "id": "fetch", "name": "Читання сторінок (Fetch)",
        "desc": "Завантажити вебсторінку за URL і віддати як текст/markdown.",
        "category": "Знання", "command": "uvx",
        "args": ["mcp-server-fetch"],
        "env": [], "needs_key": False, "recommended": True,
        "note": "Потрібен uv/uvx (python).",
    },
    {
        "id": "time", "name": "Час і таймзони",
        "desc": "Поточний час, дата, конвертація таймзон — база для нагадувань.",
        "category": "Утиліти", "command": "uvx",
        "args": ["mcp-server-time"],
        "env": [], "needs_key": False, "recommended": True,
        "note": "Офіційний. Потрібен uv/uvx.",
    },
    {
        "id": "playwright", "name": "Браузер (Playwright)",
        "desc": "Бот може відкривати сайти й взаємодіяти з ними (кліки, форми, скріншоти).",
        "category": "Веб", "command": "npx",
        "args": ["-y", "@playwright/mcp@latest"],
        "env": [], "needs_key": False, "recommended": False,
        "note": "Офіційний Microsoft. Ставить браузер при першому запуску.",
    },
    {
        "id": "exa", "name": "AI-пошук (Exa)",
        "desc": "Веб-пошук, оптимізований під AI — чисті результати з цитуванням.",
        "category": "Знання", "command": "npx",
        "args": ["-y", "exa-mcp-server"],
        "env": ["EXA_API_KEY"], "needs_key": True, "recommended": False,
        "note": "Потрібен EXA_API_KEY (exa.ai).",
    },
    {
        "id": "google-calendar", "name": "Google Календар",
        "desc": "Читати/створювати події й нагадування у Google Календарі.",
        "category": "Продуктивність", "command": "npx",
        "args": ["-y", "@cocal/google-calendar-mcp"],
        "env": [], "needs_key": True, "recommended": False,
        "note": "Потрібна авторизація Google (OAuth) — `openclaw mcp login`.",
    },
    {
        "id": "filesystem", "name": "Файли",
        "desc": "Читання/запис файлів у дозволеній папці (напр. нотатки brain/).",
        "category": "Файли", "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem",
                 "/Users/hhh/projects/claude bot/Virtual Bot/brain"],
        "env": [], "needs_key": False, "recommended": False,
        "note": "Офіційний; шлях можна змінити.",
    },
    {
        "id": "workspace", "name": "Робоча тека бота",
        "desc": "Власна тека бота на диску: проєкти, ігри, нотатки й окрема тека кожної сесії.",
        "category": "Файли", "command": "python3",
        "args": [str(BASE_DIR / "workspace_mcp.py")],
        # VBOT_URL має дефолт у самому workspace_mcp.py, ключів не треба
        "env": [], "needs_key": False, "recommended": True,
        "note": "Свій MCP: ходить у workspace/ через панель (шляхи перевіряє бекенд).",
    },
]

# Пресети — набори MCP «в один клік». Тільки id зі списку вище.
PRESETS: list[dict] = [
    {
        "id": "essential", "name": "Старт",
        "desc": "Мінімум маст-хев без ключів: памʼять, міркування, YouTube.",
        "mcp": ["memory", "sequential-thinking", "youtube"],
    },
    {
        "id": "companion", "name": "Компаньйон",
        "desc": "Для домашнього бота: памʼять, YouTube, веб-пошук, час.",
        "mcp": ["memory", "sequential-thinking", "youtube", "brave-search", "time"],
    },
    {
        "id": "all", "name": "Все рекомендоване",
        "desc": "Усі позначені як маст-хев.",
        "mcp": [m["id"] for m in MCP_SUGGESTIONS if m["recommended"]],
    },
]

SKILLS_NOTE = (
    "Скіли — з ClawHub: `openclaw skills search <тема>` → "
    "`openclaw skills install <назва>` (напр. погода, нагадування, розумний дім)."
)


def by_id(mcp_id: str) -> dict | None:
    return next((m for m in MCP_SUGGESTIONS if m["id"] == mcp_id), None)


def preset_by_id(preset_id: str) -> dict | None:
    return next((p for p in PRESETS if p["id"] == preset_id), None)


def enable_command(item: dict, env_values: dict | None = None) -> list[str]:
    """
    `openclaw mcp add …` для одного MCP. env_values: реальні значення ключів
    (з майстра) — тоді пишемо `--env KEY=<value>`; інакше посилання `${KEY}`.
    """
    env_values = env_values or {}
    cmd = ["openclaw", "mcp", "add", item["id"], "--command", item["command"]]
    for a in item.get("args", []):
        cmd += ["--arg", a]
    for e in item.get("env", []):
        val = env_values.get(e)
        cmd += ["--env", f"{e}={val}" if val else f"{e}=${{{e}}}"]
    return cmd


def display_command(item: dict) -> str:
    """Команда для показу в UI — ключі маскуємо (не світимо секрети)."""
    return " ".join(enable_command(item))
