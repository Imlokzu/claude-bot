"""
Тулза «Погода»: Nominatim (геокодування) + Open-Meteo (прогноз).
Безкоштовно, без API-ключа. Потрібен лише User-Agent для Nominatim.
"""

from __future__ import annotations

import logging
from typing import Optional

import httpx

log = logging.getLogger("virtual_bot.tools.weather")

_NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
_OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
_USER_AGENT = "KlodBot/1.0 (virtual bot assistant)"

# WMO Weather interpretation — українською, емодзі
_WMO_MAP: dict[int, tuple[str, str]] = {
    0: ("Чисте небо", "☀️"),
    1: ("Переважно ясно", "🌤"),
    2: ("Частково хмарно", "⛅"),
    3: ("Хмарно", "☁️"),
    45: ("Туман", "🌫"),
    48: ("Туман із інеєм", "🌫"),
    51: ("Легка мжичка", "🌦"),
    53: ("Помірна мжичка", "🌦"),
    55: ("Сильна мжичка", "🌧"),
    56: ("Легка мжичка, що замерзає", "🌧"),
    57: ("Сильна мжичка, що замерзає", "🌧"),
    61: ("Легкий дощ", "🌦"),
    63: ("Помірний дощ", "🌧"),
    65: ("Сильний дощ", "🌧"),
    66: ("Легкий дощ, що замерзає", "🌨"),
    67: ("Сильний дощ, що замерзає", "🌨"),
    71: ("Легкий сніг", "🌨"),
    73: ("Помірний сніг", "❄️"),
    75: ("Сильний сніг", "❄️"),
    77: ("Снігові зерна", "❄️"),
    80: ("Невелика злива", "🌦"),
    81: ("Помірна злива", "🌧"),
    82: ("Сильна злива", "⛈"),
    85: ("Невеликий сніговий дощ", "🌨"),
    86: ("Сильний сніговий дощ", "🌨"),
    95: ("Гроза", "⚡"),
    96: ("Гроза з невеликим градом", "⛈"),
    99: ("Гроза з сильним градом", "⛈"),
}


def _interpret(code: Optional[int]) -> tuple[str, str]:
    if code is None:
        return "Невідомо", "❓"
    return _WMO_MAP.get(code, ("Невідомі умови", "🌡"))


def _get_weekday_name(iso_day: str) -> str:
    names = {"0": "Нд", "1": "Пн", "2": "Вт", "3": "Ср", "4": "Чт", "5": "Пт", "6": "Сб"}
    try:
        return names.get(str(iso_day), iso_day)
    except Exception:
        return iso_day


async def get_weather(city: str) -> dict:
    """Повертає погоду для міста у вигляді dict (помилка — ключ 'error')."""
    city = city.strip()
    if not city:
        return {"error": "Вкажи місто"}

    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            geo_resp = await client.get(
                _NOMINATIM_URL,
                params={"q": city, "format": "json", "limit": "1", "accept-language": "uk,en"},
                headers={"User-Agent": _USER_AGENT},
            )
            geo_resp.raise_for_status()
            geo = geo_resp.json()
            if not geo:
                return {"error": f"Місто «{city}» не знайдено"}
            lat = float(geo[0]["lat"])
            lon = float(geo[0]["lon"])
            display_name = geo[0].get("display_name", city)
            country = ""
            if "," in display_name:
                country = display_name.split(",")[-1].strip()
    except httpx.HTTPError as exc:
        log.warning("Nominatim error: %s", type(exc).__name__)
        return {"error": "Не вдалося знайти координати міста (сервіс недоступний)"}
    except Exception as exc:
        log.warning("Nominatim parse error: %s", type(exc).__name__)
        return {"error": "Помилка геокодування"}

    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            weather_resp = await client.get(
                _OPEN_METEO_URL,
                params={
                    "latitude": lat,
                    "longitude": lon,
                    "current": "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m",
                    "daily": "weather_code,temperature_2m_max,temperature_2m_min",
                    "timezone": "auto",
                    "forecast_days": 6,
                },
            )
            weather_resp.raise_for_status()
            data = weather_resp.json()
    except httpx.HTTPError as exc:
        log.warning("Open-Meteo error: %s", type(exc).__name__)
        return {"error": "Не вдалося отримати прогноз погоди (сервіс недоступний)"}
    except Exception as exc:
        log.warning("Open-Meteo parse error: %s", type(exc).__name__)
        return {"error": "Помилка прогнозу погоди"}

    current = data.get("current", {})
    code = current.get("weather_code")
    condition, icon = _interpret(code)
    temperature = current.get("temperature_2m")
    humidity = current.get("relative_humidity_2m")
    wind_speed = current.get("wind_speed_10m")

    daily = data.get("daily", {})
    days = daily.get("time", [])
    codes = daily.get("weather_code", [])
    maxs = daily.get("temperature_2m_max", [])
    mins = daily.get("temperature_2m_min", [])

    forecast: list[dict] = []
    for i, day in enumerate(days[:5]):
        try:
            d_icon = _interpret(codes[i] if i < len(codes) else None)[1]
            forecast.append({
                "day": _get_weekday_name(day),
                "icon": d_icon,
                "max": round(maxs[i]) if i < len(maxs) else None,
                "min": round(mins[i]) if i < len(mins) else None,
            })
        except Exception:
            continue

    return {
        "city": city,
        "display": display_name,
        "country": country,
        "temperature": round(temperature) if temperature is not None else None,
        "condition": condition,
        "icon": icon,
        "humidity": humidity,
        "wind_speed": wind_speed,
        "forecast": forecast,
    }
