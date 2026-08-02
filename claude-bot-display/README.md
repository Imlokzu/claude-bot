# Claude Bot — Display UI (React + FastAPI)

React-based display UI for the Claude Bot project. Designed for a 2.4–2.6" SPI TFT resistive touchscreen on Raspberry Pi 3, but fully testable on macOS/Linux via a browser window (the virtual screen).

## Structure

```
claude-bot-display/
├── backend/                    # FastAPI + WebSocket backend
│   ├── server.py               # Main server, streaming, weather, alarms
│   ├── services.py             # Weather & alarm services
│   └── send_event.py           # CLI to send test events
├── frontend/                   # React + Vite app
│   ├── src/
│   │   ├── App.jsx             # Main app state & WebSocket
│   │   ├── components/         # PixelEyes, ScreenManager, widgets
│   │   ├── screens/            # Status, Face, Transcript, Custom
│   │   └── hooks/              # useWebSocket
│   └── package.json
├── tests/                      # pytest backend tests
├── API_CONTRACT.md             # Backend ↔ UI message contract
└── pyproject.toml
```

## Features

- Realistic virtual TFT display: fixed **320×240** resolution inside a device bezel, auto-scaled to fit the browser window
- 4 screens with swipe navigation: **Status**, **Face**, **Transcript**, **Custom**
- Pixel-art animated eyes with 15+ emotions
- Real-time streaming AI text (`speaking_chunk`)
- Weather widget (Open-Meteo, no API key)
- Clock widget + alarm system
- Dark cyberpunk/retro theme
- Auto-return to Face screen after idle

## Install

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
pip install -e .

cd frontend
npm install
cd ..
```

## Run

Terminal 1 — backend:
```bash
source .venv/bin/activate
python -m backend.server --port 8001
```

Terminal 2 — React dev server (opens browser):
```bash
cd frontend
npm run dev
```

The browser window simulates the virtual TFT display. Swipe left/right with mouse or finger. The device frame is fixed at 320×240 pixels and scales automatically to fit your screen.

## Production build

```bash
cd frontend
npm run build
```

Serve `frontend/dist/` with any static server.

## Test

```bash
pytest
```

## Send test events manually

```bash
source .venv/bin/activate

python -m backend.send_event --type emotion_change --data '{"emotion":"happy"}'
python -m backend.send_event --type heard --data '{"text":"Привіт, Клоде"}'
python -m backend.send_event --type speaking_chunk --data '{"text":"Привіт"}'
python -m backend.send_event --type speaking_chunk --data '{"text":", як справи?"}'
python -m backend.send_event --type speaking_end --data '{}'
python -m backend.send_event --type show_custom --data '{"content_type":"list","content":"1. Кава\n2. Тост","duration_seconds":10}'
python -m backend.send_event --type show_custom --data '{"content_type":"timer","content":"30","duration_seconds":35}'
```

## API

- `GET /health` — health check
- `GET /weather?city=Kyiv` — current weather
- `POST /alarms?hour=7&minute=30&label=Wake+up` — create alarm
- `GET /alarms` — list alarms
- `DELETE /alarms/{id}` — delete alarm
- `WS /ws/display` — main WebSocket channel

## Configuration

The WebSocket URL defaults to `ws(s)://<page-hostname>:8001/ws/display`. Set the `VITE_WS_URL` env var (e.g. in `frontend/.env`) to override it.
Edit `backend/services.py` to change the default weather city.
