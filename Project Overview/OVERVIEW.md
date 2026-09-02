# Claude Bot — Project Overview

A plain-language summary of what this repo actually is, what it's good/bad at
right now, and what it costs. Sourced from [`README.md`](../README.md),
[`STATUS.md`](../STATUS.md), [`claude-bot-full-spec-v3.md`](../claude-bot-full-spec-v3.md)
and the landing page config ([`landing/src/config.js`](../landing/src/config.js)).
Written 2026-08-15 — statuses move fast, recheck against `STATUS.md` before quoting.

---

## 1. What it is

A **DIY personal AI companion robot**, built software-first. The end goal is a
physical body — camera, mic, speaker, touchscreen, eventually wheels — running
on a **Raspberry Pi**, talking to a **home i5 server**, with **Claude (or other
LLMs)** as the "personality" doing the thinking. Right now, before any hardware
is bought, everything runs virtually on a laptop/server (**"Virtual Bot"**).

Compared to Alexa/Google Home, the pitch is: it has (eventually) a physical
presence, persistent personal memory about the specific people in the house,
and can do tasks that need movement/recognition ("find me and remind me").

### Three-tier architecture
| Tier | Device | Latency | Job |
|---|---|---|---|
| Edge (reflex) | Raspberry Pi | <50 ms | Sensors, local UI, obstacle avoidance |
| Fog (processing) | Home i5 server | 100–500 ms | Orchestration, scheduling, memory |
| Cloud (thinking) | Claude / other LLM APIs | 300 ms–3 s | Vision, conversation, decisions |

### The pieces in this repo
| Module | What it does |
|---|---|
| **Virtual Bot** | The control panel / brain — chat UI, tools (mail, notes, weather, vision, voice, memory, web search…), memory panel, workspace, works before hardware exists |
| **Vision Agent** | Face + motion detection over HTTP (FastAPI + OpenCV) |
| **Voice Loop** | Whisper speech-to-text → LLM → text-to-speech |
| **claude-bot-display** | The "face" — pixel eyes, 15+ emotions, multiple screens |
| **Remote Control** | Physical USB remote + I2C LCD status, for the real Pi |
| **Device Setup Wizard** | Electron desktop app for first-time hardware setup |
| **OpenClaw Vision Plugin** | Lets the agent call the camera as a tool |
| **landing/** | Marketing/landing site (3D scene, pricing, model picker) |

---

## 2. What it can do today

- Chat with an LLM "brain" through a web control panel, with a persistent memory store
- Call tools: mail, notes, weather, web search, vision (camera), voice, memory recall
- Route between multiple LLM providers/models (not locked to one vendor)
- Detect faces/motion via webcam (Vision Agent)
- Speak and listen via Whisper STT + TTS (Voice Loop) — desktop only so far
- Show an animated emotional "face" UI (pixel eyes, screens) over WebSocket
- Guided setup wizard app for eventually configuring real hardware
- All of the above runs **without owning any hardware** — pure software prototype

## 3. What it can't do yet

- No physical body — no movement, no real camera/mic/speaker on a Pi in daily use
- No long-term RAG memory/search layer (listed "not started" in `STATUS.md`)
- No emotion *engine* driving behavior (only the visual face exists)
- No face recognition or spatial navigation ("find_person" is roadmap, not built)
- Known bugs: Voice Loop's TTS engine can hang/go silent on macOS re-use (P1); Vision Agent can 500 instead of 400 on oversized/empty images (P2); Display WebSocket cleanup can duplicate under React StrictMode (P2)
- No production hardening — statuses in `STATUS.md` explicitly say "not ready for production"

---

## 4. Pros

- **Software-first**: you can build and test the entire brain, memory, tools, and face before spending a dollar on hardware
- **Model-agnostic**: the landing page advertises routing across 13 models (Claude, GPT, Gemini, DeepSeek, Qwen, Mistral, Grok, GLM, Kimi, Perplexity, MiniMax, Meta, MiMo) — not locked into one vendor or price
- **Open hardware plan**: full schematics/BOM/firmware are meant to be free — you're not buying a sealed appliance, you own and can modify the whole thing
- **Local-first memory**: memory is stored on your own disk, not just in a vendor cloud
- **Modular**: vision, voice, display, and remote control are separate services — you can run/replace any one independently
- **Tiered hardware options**: cheap Pi Zero (~$79, cloud-only) up to Pi 5 (~$149, fully offline STT + face recognition) — buy-in scales with how much you want to spend
- **Cheap to start**: the "Virtual Bot" needs no hardware at all — just a machine to run FastAPI on

## 5. Cons

- **Early-stage / DIY**: this is a hobbyist project under active development, not a polished consumer product — several core features (memory search, emotion logic, navigation) are unbuilt
- **Known bugs still open**, including one rated P1 (voice loop can hang)
- **Requires real assembly**: even at the cheap tier, you're wiring a Pi, camera, mic, and speaker yourself — not plug-and-play
- **Ongoing cloud cost**: the "thinking" tier depends on paid LLM API calls (see pricing below) — this is not a one-time purchase if you want the AI brain
- **UI/code comments are in Ukrainian** by project convention, which raises the bar for outside contributors
- **No security/production hardening yet** — explicitly documented as unverified for things like path traversal
- **Latency is real**: cloud "thinking" tier is quoted at 300 ms–3 s, so it won't feel as snappy as a dedicated voice assistant appliance for quick queries

---

## 6. Pricing

Two separate costs — hardware (one-time, optional) and AI subscription (recurring), per the landing page (`landing/src/config.js`):

### Hardware (one-time, DIY — you build it)
| Board | Price | You get |
|---|---|---|
| Pi Zero 2 W | **$79** | USB mic + speaker only, no camera, cloud vision/STT, 512 MB RAM |
| Raspberry Pi 4 *(marked "popular")* | **$119** | + CSI camera, mic array, 2.4" touch display, I2S speaker |
| Raspberry Pi 5 | **$149** | + local Whisper STT, face recognition, distance sensing (fully offline) |

Blueprints, schematics, BOM, and firmware source are advertised as **free, forever** (open source tier).

### AI subscription (recurring — powers the "brain")
| Plan | Price | Includes |
|---|---|---|
| AI Subscription | **$19/month** | Access to all 13 routed models under one key, unlimited routing, priority latency, cancel anytime |

Note: this pricing lives in the **landing page marketing copy**, not in a billing
system — there's no evidence in the repo of it being wired up to real payments
yet. Treat it as the intended price point, not a live, working checkout.

---

## 7. Bottom line

If you like tinkering and want a fully-yours, locally-stored, multi-model AI
companion that starts as pure software and can grow into real hardware for
$79–$149, this is a solid base to build on. If you want something that works
out of the box today — voice assistant, physical body, hardened security — it
isn't there yet; several headline features (long-term memory, emotions,
navigation) are still on the roadmap, and there's at least one known P1 bug.
