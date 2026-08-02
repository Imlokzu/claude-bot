"""
Тулза «Курси валют»: ExchangeRate-API (open.er-api.com), без ключа.
"""

from __future__ import annotations

import logging

import httpx

log = logging.getLogger("virtual_bot.tools.currency")

_API_URL = "https://open.er-api.com/v6/latest/"

# Типові коди валют, які ми дозволяємо
_COMMON_CURRENCIES = {
    "USD", "EUR", "UAH", "GBP", "PLN", "CZK", "RON", "HUF", "BGN",
    "CHF", "JPY", "CNY", "TRY", "AUD", "CAD"
}


def _date_from_api(data: dict) -> str | None:
    """Витягує дату оновлення з відповіді API (формат 'Sat, 01 Aug 2026 ...')."""
    utc = data.get("time_last_update_utc", "")
    parts = utc.split(" ")
    if len(parts) >= 4:
        return f"{parts[1]} {parts[2]} {parts[3]}"
    return data.get("date")


async def get_rate(base: str, target: str) -> dict:
    """Повертає курс base -> target. Помилка — ключ 'error'."""
    base = (base or "").strip().upper()
    target = (target or "").strip().upper()
    if not base or not target:
        return {"error": "Вкажи обидві валюти, наприклад USD і UAH"}
    if base == target:
        return {"error": "Валюти мають бути різними"}

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{_API_URL}{base}")
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as exc:
        log.warning("Currency API error: %s", type(exc).__name__)
        return {"error": "Не вдалося отримати курс (сервіс недоступний)"}
    except Exception as exc:
        log.warning("Currency parse error: %s", type(exc).__name__)
        return {"error": "Помилка курсу валют"}

    if data.get("result") != "success":
        return {"error": "Сервіс курсів повернув помилку"}

    rates = data.get("rates", {})
    if target not in rates:
        return {"error": f"Курс {base}/{target} недоступний"}

    rate = rates[target]
    return {
        "base": base,
        "target": target,
        "rate": rate,
        "inverse": round(1 / rate, 6) if rate else None,
        "date": _date_from_api(data),
    }


async def get_common_rates(target: str = "UAH") -> dict:
    """Повертає курси популярних валют до target (для загального запиту)."""
    target = (target or "UAH").strip().upper()
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{_API_URL}{target}")
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        log.warning("Currency common rates error: %s", type(exc).__name__)
        return {"error": "Не вдалося отримати курси"}

    if data.get("result") != "success":
        return {"error": "Сервіс курсів повернув помилку"}

    rates = data.get("rates", {})
    return {
        "target": target,
        "date": _date_from_api(data),
        "rates": {k: round(1 / v, 4) for k, v in rates.items() if v and k in _COMMON_CURRENCIES and k != target},
    }
