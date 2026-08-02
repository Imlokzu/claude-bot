# Claude Bot Display — API Contract

## Transport

- UI connects to backend via a single WebSocket endpoint: `ws://<host>:<port>/ws/display`
- Default development URL: `ws://localhost:8001/ws/display`
- Backend may also expose REST endpoints (see below).

## REST endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/health` | Health check: `{"status":"ok"}` |
| GET | `/weather?city=Kyiv` | Current weather from Open-Meteo |
| POST | `/alarms?hour=7&minute=30&label=Wake+up` | Create alarm |
| GET | `/alarms` | List active alarms |
| DELETE | `/alarms/{id}` | Delete alarm |

## Backend → UI push events

All messages are JSON objects with a `type` field.

### `state_update`

```json
{
  "type": "state_update",
  "data": {
    "battery": 78,
    "charging": true,
    "wifi_connected": true,
    "wifi_ssid": "home-wifi",
    "server_online": true,
    "current_model": "Claude Sonnet 5",
    "cpu_percent": 38,
    "temperature_c": 42
  }
}
```

### `emotion_change`

```json
{
  "type": "emotion_change",
  "data": { "emotion": "happy" }
}
```

Supported emotions: `neutral`, `idle`, `listening`, `thinking`, `speaking`, `happy`, `excited`, `surprised`, `shocked`, `angry`, `sad`, `sleepy`, `confused`, `love`, `suspicious`.

### `heard`

```json
{
  "type": "heard",
  "data": { "text": "Клод бот, яка погода?" }
}
```

UI switches to the `transcript` screen.

### `speaking`

Full final text (non-streaming):

```json
{
  "type": "speaking",
  "data": { "text": "Зараз +18, хмарно..." }
}
```

### `speaking_chunk`

Streaming chunk to append to the bot message:

```json
{
  "type": "speaking_chunk",
  "data": { "text": "+18" }
}
```

### `speaking_end`

Marks the end of streaming:

```json
{
  "type": "speaking_end",
  "data": {}
}
```

### `show_custom`

```json
{
  "type": "show_custom",
  "data": {
    "content_type": "list",
    "content": "1. Змішати яйця\n2. Додати борошно\n3. Смажити 2 хв",
    "duration_seconds": 30
  }
}
```

Supported `content_type`: `text`, `list`, `timer`, `qr_code`, `image_url`.

- `duration_seconds: 0` — show until replaced.
- Positive value — auto-return to `face` after N seconds.

### `weather_update`

```json
{
  "type": "weather_update",
  "data": {
    "temp_c": 18,
    "condition": "Partly cloudy",
    "icon": "⛅",
    "location": "Kyiv",
    "humidity": 64,
    "wind_kph": 12
  }
}
```

### `clock_tick`

```json
{
  "type": "clock_tick",
  "data": {
    "time": "14:35:02",
    "date": "Tuesday, 21 July"
  }
}
```

### `alarm_triggered`

```json
{
  "type": "alarm_triggered",
  "data": {
    "id": "abc123",
    "label": "Wake up"
  }
}
```

UI switches to `custom` screen and shows the alarm.

## UI → Backend events

### `swipe`

```json
{
  "type": "swipe",
  "data": {
    "from_screen": "face",
    "to_screen": "status",
    "direction": "right"
  }
}
```

### `touch`

```json
{
  "type": "touch",
  "data": {
    "screen": "custom",
    "x": 120,
    "y": 80,
    "action": "tap"
  }
}
```

## Screen names

- `status`
- `face`
- `transcript`
- `custom`

Default screen: `face`.
