# Клод Бот (Claude Bot)

A DIY personal AI companion. The physical bot will be a **Raspberry Pi 3**
(camera, mic, speaker, SPI touchscreen) talking to a **home i5 server** and the
**Claude API** as its "personality". The guiding philosophy is **software first,
hardware later** — every module runs virtually on macOS/Linux today, before any
hardware is purchased.

> UI text and code comments are written in **Ukrainian** — please keep that
> convention (see `AGENTS.md`).

**Key docs:**
- [`claude-bot-full-spec-v3.md`](claude-bot-full-spec-v3.md) — full architecture (Edge/Fog/Cloud), BOM, roadmap
- [`claude-bot-dev-order.md`](claude-bot-dev-order.md) — development order (6 steps)
- [`HANDOFF.md`](HANDOFF.md) — session handoff, current state, known bugs, next tasks
- [`AGENTS.md`](AGENTS.md) — rules for AI agents/tools working in this repo

---

## Architecture (three tiers)

| Tier | Device | Latency | Role |
|---|---|---|---|
| **Edge** (reaction) | Raspberry Pi 3 | <50 ms | Sensors, local UI, obstacle-avoidance reflexes |
| **Fog** (processing) | Home i5 server | 100–500 ms | Orchestration, scheduler, memory, light ML |
| **Cloud** (thinking) | Anthropic / Groq API | 300 ms–3 s | Vision analysis, conversation, decisions |

---

## Modules

| Folder | What it does | Stack | Port |
|---|---|---|---|
| [`Vision Agent/`](Vision%20Agent/) | Eyes: face + motion detection over HTTP | FastAPI + OpenCV | **8000** |
| [`Voice Loop/`](Voice%20Loop/) | Ears/mouth: Whisper STT → OpenClaw → pyttsx3 TTS | Python | — |
| [`OpenClaw Vision Plugin/`](OpenClaw%20Vision%20Plugin/) | `vision_check_camera` tool for the agent | TypeScript | — |
| [`claude-bot-display/`](claude-bot-display/) | Face: pixel eyes, 15+ emotions, 4 screens | FastAPI + React/Vite | **8001** (WS) |
| [`Remote Control/`](Remote%20Control/) | USB remote (VID:PID `0627:697d`) + I2C LCD status | Python (Pi) | — |
| [`Device Setup Wizard/`](Device%20Setup%20Wizard/) | "Claude Bot Studio" — setup UI | Electron + Vite/React/TS | — |
| [`Virtual Bot/`](Virtual%20Bot/) | Virtual bot + control panel (runs before hardware exists) | FastAPI + vanilla JS | **8100** |

**Brain / gateway:** OpenClaw gateway runs at `127.0.0.1:18789`. Other optional
brains used by Virtual Bot: Omni router (`:20128`), direct Anthropic API,
Chat2API (`:8080`), and a built-in demo mode so the app always works.

---

## How to run each module

> The project path contains a space — always quote paths (`cd "Virtual Bot"`).

### Virtual Bot (recommended starting point) — port 8100
```bash
cd "Virtual Bot"
./start.sh          # creates .venv, installs deps, starts uvicorn
# then open http://127.0.0.1:8100
```
Manual:
```bash
cd "Virtual Bot"
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt
./.venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8100
```

### Vision Agent — port 8000
```bash
cd "Vision Agent"
pip install -r requirements.txt --break-system-packages
uvicorn main:app --reload --host 0.0.0.0 --port 8000
# health: curl http://127.0.0.1:8000/health
python test_webcam.py   # optional live webcam test (quit with q)
```

### Voice Loop
```bash
cd "Voice Loop"
pip install -r requirements.txt --break-system-packages
# Requires OpenClaw gateway running on :18789 and a token in config.yaml
python voice_loop.py    # speak after "Слухаю…", Ctrl+C to quit
```

### claude-bot-display — port 8001
```bash
cd claude-bot-display
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt && pip install -e .
cd frontend && npm install && cd ..

# Terminal 1 (backend):
python -m backend.server --port 8001
# Terminal 2 (frontend dev server):
cd frontend && npm run dev
```

### OpenClaw Vision Plugin
```bash
cd "OpenClaw Vision Plugin"
npm install
npm run plugin:build      # compile TS → dist/, generate manifest
npm run plugin:validate   # validate manifest with OpenClaw CLI
npm test
openclaw plugins install .   # install into OpenClaw, then restart the gateway
```
Requires **Vision Agent** running on `:8000`.

### Device Setup Wizard (Electron app)
```bash
cd "Device Setup Wizard"
npm install
npm run dev            # Vite dev server
npm run electron:dev   # run the Electron app in dev
npm run electron:build # build a distributable (dmg/nsis/AppImage)
```

### Remote Control (runs on the Raspberry Pi)
```bash
cd "Remote Control"
pip install evdev --break-system-packages
python3 remote_listener.py   # user must be in the `input` group
```

---

## Secrets

**Never commit tokens or API keys.** Secrets come from environment variables or
a local, git-ignored `.env` file (see `.gitignore`):

- `OMNI_API_KEY` — Omni router key (Virtual Bot main brain)
- `OPENCLAW_TOKEN` — OpenClaw gateway token
- `ANTHROPIC_API_KEY` — direct Anthropic API key
- `CHAT2API_API_KEY` — optional local Chat2API key

---

## Roadmap (see spec for detail)

- **Phase 0** — Software prototype, no hardware (now)
- **Phase 1** — Sensor core (camera, mic, speaker, display on RPi3)
- **Phase 2** — Mobility (4WD chassis, motors, rangefinder)
- **Phase 3** — Agent + memory (tool use, Telegram notifications, RAG, dream cycle)
- **Phase 4** — Spatial awareness (face recognition, reactive navigation, `find_person`)

Done so far: vision (step 1), voice loop via OpenClaw (step 3), display UI
(partial step 6). Not started: RAG memory (step 2), emotion layer (step 4),
face recognition, navigation.

---

## Contributing / AI agents

This repo is worked on by AI coding tools. **All contributors (human or AI) must
follow [`AGENTS.md`](AGENTS.md)**: commit after every logical change, use
Conventional Commits, run the relevant tests/builds, and never commit secrets.
