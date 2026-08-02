"""
«Клод Бот» — Virtual Bot: профіль бота з майстра першого налаштування.

Зберігає імʼя, мову, характер і привітання у bot_profile.json. Ці значення
РЕАЛЬНО йдуть у системний промпт (див. brains.build_system_prompt), тож вибір
у майстрі одразу змінює поведінку бота (мову відповіді, тон, персону).
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

log = logging.getLogger("virtual_bot.profile")

BASE_DIR = Path(__file__).resolve().parent
PROFILE_PATH = BASE_DIR / "bot_profile.json"

# Підтримувані мови: код → (назва в UI, інструкція для промпту)
LANGUAGES: dict[str, dict[str, str]] = {
    "uk": {"label": "Українська", "instruction": "Відповідай УКРАЇНСЬКОЮ мовою."},
    "en": {"label": "English", "instruction": "Reply in ENGLISH."},
    "pl": {"label": "Polski", "instruction": "Odpowiadaj po POLSKU."},
    "es": {"label": "Español", "instruction": "Responde en ESPAÑOL."},
    "de": {"label": "Deutsch", "instruction": "Antworte auf DEUTSCH."},
}

# Пресети характеру: id → (назва, емодзі-іконка, короткий опис, рядок для промпту)
PERSONAS: dict[str, dict[str, str]] = {
    "friendly": {"label": "Дружній", "icon": "😊", "hint": "теплий і доброзичливий",
                 "prompt": "Ти теплий, доброзичливий і трохи грайливий."},
    "playful": {"label": "Грайливий", "icon": "😜", "hint": "веселий і жартівливий",
                "prompt": "Ти веселий, жартівливий і енергійний."},
    "concise": {"label": "Лаконічний", "icon": "🎯", "hint": "коротко й по суті",
                "prompt": "Ти стриманий і лаконічний, відповідаєш коротко й по суті."},
    "calm": {"label": "Спокійний", "icon": "🌿", "hint": "уважний і розважливий",
             "prompt": "Ти спокійний, уважний і розважливий помічник."},
    "wise": {"label": "Мудрий", "icon": "🦉", "hint": "вдумливий наставник",
             "prompt": "Ти вдумливий, ерудований наставник; пояснюєш глибоко, але зрозуміло."},
    "energetic": {"label": "Енергійний", "icon": "⚡", "hint": "бадьорий і мотивуючий",
                  "prompt": "Ти бадьорий, енергійний і мотивуючий, заряджаєш оптимізмом."},
    "witty": {"label": "Дотепний", "icon": "😏", "hint": "з легким гумором",
              "prompt": "Ти дотепний, з легким гумором і самоіронією, але не образливий."},
    "professional": {"label": "Діловий", "icon": "💼", "hint": "чіткий і фаховий",
                     "prompt": "Ти чіткий, фаховий і зібраний, як досвідчений асистент."},
}

# Довжина відповідей: id → (назва, рядок для промпту)
REPLY_LENGTHS: dict[str, dict[str, str]] = {
    "short": {"label": "Короткі", "prompt": "Відповідай дуже коротко — 1–2 речення."},
    "medium": {"label": "Середні", "prompt": "Відповідай стисло — зазвичай 1–4 речення."},
    "detailed": {"label": "Детальні", "prompt": "Відповідай докладно, з поясненнями, коли доречно."},
}

_DEFAULTS: dict[str, Any] = {
    "configured": False,
    "name": "Клод Бот",
    "language": "uk",
    "persona": "friendly",
    "persona_custom": "",   # якщо задано — має пріоритет над пресетом
    "greeting": "",         # необовʼязкове стартове привітання
    "reply_length": "medium",
    "use_emoji": True,
    "spontaneous": True,    # спонтанні емоції у простої
}


def load() -> dict[str, Any]:
    """Читає профіль (bot_profile.json) з дефолтами; битий файл → дефолти."""
    data = dict(_DEFAULTS)
    try:
        raw = json.loads(PROFILE_PATH.read_text(encoding="utf-8"))
        if isinstance(raw, dict):
            for k in _DEFAULTS:
                if k in raw:
                    data[k] = raw[k]
    except (OSError, ValueError):
        pass
    return data


def save(patch: dict[str, Any]) -> dict[str, Any]:
    """Оновлює профіль наданими полями (валідує), позначає configured=True."""
    data = load()
    if "name" in patch:
        data["name"] = str(patch["name"]).strip()[:60] or _DEFAULTS["name"]
    if "language" in patch and patch["language"] in LANGUAGES:
        data["language"] = patch["language"]
    if "persona" in patch and patch["persona"] in PERSONAS:
        data["persona"] = patch["persona"]
    if "persona_custom" in patch:
        data["persona_custom"] = str(patch["persona_custom"]).strip()[:400]
    if "greeting" in patch:
        data["greeting"] = str(patch["greeting"]).strip()[:300]
    if "reply_length" in patch and patch["reply_length"] in REPLY_LENGTHS:
        data["reply_length"] = patch["reply_length"]
    if "use_emoji" in patch:
        data["use_emoji"] = bool(patch["use_emoji"])
    if "spontaneous" in patch:
        data["spontaneous"] = bool(patch["spontaneous"])
    data["configured"] = True
    PROFILE_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    log.info("Профіль бота оновлено (імʼя=%s, мова=%s, персона=%s)",
             data["name"], data["language"], data["persona_custom"] and "custom" or data["persona"])
    return data


def persona_prompt(profile: dict[str, Any]) -> str:
    """Рядок характеру для промпту: кастомний текст або пресет."""
    custom = (profile.get("persona_custom") or "").strip()
    if custom:
        return custom
    preset = PERSONAS.get(profile.get("persona", "friendly"), PERSONAS["friendly"])
    return preset["prompt"]


def language_instruction(profile: dict[str, Any]) -> str:
    """Інструкція про мову відповіді для промпту."""
    lang = LANGUAGES.get(profile.get("language", "uk"), LANGUAGES["uk"])
    return lang["instruction"]


def style_prompt(profile: dict[str, Any]) -> str:
    """Рядок стилю (довжина + емодзі) для промпту."""
    length = REPLY_LENGTHS.get(profile.get("reply_length", "medium"), REPLY_LENGTHS["medium"])
    emoji = "Доречно вживай емодзі." if profile.get("use_emoji", True) else "НЕ вживай емодзі."
    return length["prompt"] + " " + emoji
