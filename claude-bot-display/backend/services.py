"""Backend services: weather, alarms, clock."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

import httpx


@dataclass
class WeatherData:
    temp_c: float
    condition: str
    icon: str
    location: str
    humidity: int | None = None
    wind_kph: float | None = None


async def fetch_weather(city: str = "Kyiv") -> WeatherData:
    """Fetch current weather from Open-Meteo (no API key required)."""
    try:
        # Geocoding
        async with httpx.AsyncClient(timeout=10) as client:
            geo_resp = await client.get(
                "https://geocoding-api.open-meteo.com/v1/search",
                params={"name": city, "count": 1},
            )
            geo_resp.raise_for_status()
            geo = geo_resp.json()
            results = geo.get("results") or []
            if not results:
                return WeatherData(temp_c=0, condition="Unknown", icon="❓", location=city)
            lat = results[0]["latitude"]
            lon = results[0]["longitude"]
            location_name = results[0].get("name", city)

            weather_resp = await client.get(
                "https://api.open-meteo.com/v1/forecast",
                params={
                    "latitude": lat,
                    "longitude": lon,
                    "current": "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m",
                    "timezone": "auto",
                },
            )
            weather_resp.raise_for_status()
            data = weather_resp.json()
            current = data.get("current", {})
            temp = current.get("temperature_2m", 0)
            humidity = current.get("relative_humidity_2m")
            wind = current.get("wind_speed_10m")
            code = current.get("weather_code", 0)
            condition, icon = _weather_code_to_condition(code)

            return WeatherData(
                temp_c=temp,
                condition=condition,
                icon=icon,
                location=location_name,
                humidity=humidity,
                wind_kph=wind,
            )
    except Exception as exc:  # pragma: no cover - defensive
        return WeatherData(temp_c=0, condition=f"Error: {exc}", icon="⚠️", location=city)


def _weather_code_to_condition(code: int) -> tuple[str, str]:
    """Map WMO weather code to human-readable condition and icon."""
    mapping = {
        0: ("Clear sky", "☀️"),
        1: ("Mainly clear", "🌤️"),
        2: ("Partly cloudy", "⛅"),
        3: ("Overcast", "☁️"),
        45: ("Fog", "🌫️"),
        48: ("Depositing rime fog", "🌫️"),
        51: ("Light drizzle", "🌦️"),
        53: ("Moderate drizzle", "🌦️"),
        55: ("Dense drizzle", "🌧️"),
        61: ("Slight rain", "🌧️"),
        63: ("Moderate rain", "🌧️"),
        65: ("Heavy rain", "🌧️"),
        71: ("Slight snow", "🌨️"),
        73: ("Moderate snow", "🌨️"),
        75: ("Heavy snow", "❄️"),
        77: ("Snow grains", "🌨️"),
        80: ("Slight rain showers", "🌦️"),
        81: ("Moderate rain showers", "🌧️"),
        82: ("Violent rain showers", "⛈️"),
        85: ("Slight snow showers", "🌨️"),
        86: ("Heavy snow showers", "❄️"),
        95: ("Thunderstorm", "⛈️"),
        96: ("Thunderstorm with hail", "⛈️"),
        99: ("Thunderstorm with heavy hail", "⛈️"),
    }
    return mapping.get(code, ("Unknown", "❓"))


@dataclass
class Alarm:
    id: str
    hour: int
    minute: int
    label: str
    enabled: bool = True


class AlarmService:
    def __init__(self) -> None:
        self._alarms: dict[str, Alarm] = {}
        self._triggered_today: set[str] = set()

    def add(self, alarm: Alarm) -> None:
        self._alarms[alarm.id] = alarm
        self._triggered_today.discard(alarm.id)

    def remove(self, alarm_id: str) -> bool:
        if alarm_id in self._alarms:
            del self._alarms[alarm_id]
            self._triggered_today.discard(alarm_id)
            return True
        return False

    def list(self) -> list[Alarm]:
        return list(self._alarms.values())

    def tick(self) -> list[Alarm]:
        """Return alarms that should trigger now."""
        now = datetime.now()
        triggered = []
        for alarm in self._alarms.values():
            if not alarm.enabled:
                continue
            if alarm.id in self._triggered_today:
                continue
            if now.hour == alarm.hour and now.minute == alarm.minute:
                triggered.append(alarm)
                self._triggered_today.add(alarm.id)
        # Reset triggered set when minute changes
        if now.second == 0 and now.microsecond < 500000:
            for alarm in self._alarms.values():
                if now.hour != alarm.hour or now.minute != alarm.minute:
                    self._triggered_today.discard(alarm.id)
        return triggered


_alarm_service = AlarmService()


def get_alarm_service() -> AlarmService:
    return _alarm_service
