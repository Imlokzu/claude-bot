"""
Ключі OpenCode Zen / Go для кодинг-агента.

Кодинг-агент (omp) ходить у моделі OpenCode НАПРЯМУ, а не через Omni-шим:
йому потрібен tool-calling, щоб читати й змінювати файли, а шим віддає лише
текст (усередині нього opencode крутить власний агентний цикл).

Ключі живуть у сторонньому застосунку — CLI `opencode`. Своєї копії НЕ
тримаємо: дублікат секрету старіє й розходиться з оригіналом. Пріоритет у
справжніх env-змінних, тож ключ можна задати і в .env бота.

Zen і Go мають РІЗНІ ключі (перевірено) — звідси дві змінні.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

# Файл авторизації CLI `opencode`. Читаємо, не пишемо.
AUTH_PATH = Path.home() / ".local/share/opencode/auth.json"

# Провайдер у auth.json → імʼя env-змінної, яку чекає профіль omp
# (~/.omp/profiles/<profile>/agent/models.yml, поле apiKey).
PROVIDER_ENV = {
    "opencode": "OPENCODE_ZEN_API_KEY",      # https://opencode.ai/zen/v1
    "opencode-go": "OPENCODE_GO_API_KEY",    # https://opencode.ai/zen/go/v1
}


def opencode_keys() -> dict[str, str]:
    """
    {імʼя_env: ключ} для передачі в підпроцес omp.

    Значення СЕКРЕТНІ: не логувати, не повертати в API, не писати у файли.
    Відсутній ключ просто не потрапляє у словник — omp тоді скаже про це сам,
    і це зрозуміліше, ніж порожній рядок замість ключа.
    """
    out: dict[str, str] = {}
    missing: list[str] = []

    for provider, var in PROVIDER_ENV.items():
        value = (os.environ.get(var) or "").strip()
        if value:
            out[var] = value
        else:
            missing.append(provider)

    if not missing:
        return out

    try:
        data = json.loads(AUTH_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        # Немає opencode або файл битий — не наша аварія: повертаємо що є.
        return out

    if not isinstance(data, dict):
        return out

    for provider in missing:
        entry = data.get(provider)
        if not isinstance(entry, dict):
            continue
        key = entry.get("key")
        if isinstance(key, str) and key.strip():
            out[PROVIDER_ENV[provider]] = key.strip()

    return out
