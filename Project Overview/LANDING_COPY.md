# Claude Bot — Landing Page Copy

Raw content blocks for a landing page, ready to paste into any design. Pulled
from the same sources as [`OVERVIEW.md`](OVERVIEW.md) — repo README, STATUS.md,
spec doc, and the existing `landing/src/config.js`. Swap/trim freely; nothing
here is final wording.

---

## Hero

**Headline:** Your AI companion, before you buy the body.

**Subhead:** Claude Bot is a DIY personal AI robot you can build in software
first — chat, memory, vision, and voice all running on your own machine —
then grow into real hardware for $79–$149 whenever you're ready.

**Primary CTA:** Get the blueprints (free)
**Secondary CTA:** Power it up — $19/mo

---

## What it is (one paragraph)

Claude Bot is an open-source AI companion that starts as pure software and
becomes a physical robot over time. It runs a "brain" (Claude or 12 other
routed models), a persistent local memory, a set of tools (mail, notes,
weather, web search, vision, voice), and an animated emotional face — all
before you own a single Raspberry Pi. When you're ready, the same brain plugs
into real hardware: a camera, a mic, a speaker, and a touchscreen face.

---

## Features (for a feature grid)

- **Multi-model brain** — routes across 13 models (Claude, ChatGPT, Gemini, DeepSeek, Qwen, Mistral, Grok, GLM, Kimi, Perplexity, MiniMax, Meta, MiMo) under one key. Not locked to one vendor.
- **Local-first memory** — remembers you, your people, and your projects, stored on your own disk, not just a vendor cloud.
- **Tool-using agent** — mail (drafts, never sends without you), notes, weather, live web search, camera vision, voice.
- **Sees and hears** — face/motion detection over camera, Whisper speech-to-text, natural text-to-speech.
- **A face that reacts** — animated pixel-eye display with 15+ emotional states.
- **Open hardware** — full schematics, bill of materials, and firmware are free forever. You own and can modify the whole thing.
- **Grows with you** — start on pure software, upgrade to a $79 Pi Zero build, or go fully offline with a $149 Pi 5.

---

## Pillars / values (short taglines, already used on the current site)

- **Priorities** — You come first. Every cycle serves your intent.
- **Open Source** — Blueprints and parts are free. The mind is yours to read.
- **Safety** — Boundaries by design. It refuses what it shouldn't do.
- **Community** — Built in the open, shaped by the people who run it.
- **Friendly** — Cold on the outside. Warm where it counts.

---

## Why it's different (pros, landing-voice)

- **Start with $0.** No hardware required to try the whole brain, memory, and tools.
- **Not locked to one AI company.** Route between 13 models instead of being stuck with one vendor's price and limits.
- **You own it.** Open schematics and firmware — no sealed black-box appliance.
- **Memory stays home.** Personal facts and history live on your disk.
- **Pick your hardware tier.** $79 pocket build up to $149 fully-offline build — pay for only what you need.

## Honest caveats (use in an FAQ or "in progress" section, not as headline copy)

- This is an early-stage DIY project, not a finished consumer product — some features (long-term memory search, emotion-driven behavior, face recognition, navigation) are still on the roadmap.
- Hardware builds require real assembly (wiring a Pi, camera, mic, speaker) — not plug-and-play.
- The AI brain needs an ongoing subscription (or your own API key) to think — hardware cost is one-time, intelligence is recurring.
- Cloud responses can take up to a few seconds; it's not tuned yet for split-second voice-assistant speed.

---

## Pricing block

### Hardware — one-time, build it yourself
| Tier | Price | Includes |
|---|---|---|
| Pi Zero 2 W | **$79** | USB mic + speaker, no camera, cloud vision & STT, 512 MB RAM |
| Raspberry Pi 4 ⭐ *Most popular* | **$119** | + CSI camera, USB mic array, 2.4" SPI touch display, I2S speaker |
| Raspberry Pi 5 | **$149** | Everything above + local Whisper STT, face recognition, distance sensing (fully offline) |

Blueprints, bill of materials, and firmware source: **free, forever.**

### Intelligence — recurring
| Plan | Price | Includes |
|---|---|---|
| AI Subscription | **$19/month** | All 13 routed models, one key, unlimited routing, priority latency, cancel anytime |

---

## Suggested FAQ

**Do I need to buy hardware to try it?**
No — the whole brain, memory, and tools run as "Virtual Bot" on a regular
computer before you buy anything.

**Which AI models does it use?**
It routes across 13 models — Claude, ChatGPT, Gemini, DeepSeek, Qwen,
Mistral, Grok, GLM, Kimi, Perplexity, MiniMax, Meta, and Xiaomi MiMo — so
you're not locked into one provider.

**What hardware do I need for the full experience?**
A Raspberry Pi (Zero 2 W, 4, or 5 depending on how much you want local vs.
cloud), a camera, a mic, a speaker, and a small touchscreen. Full BOM is in
the open-source blueprints.

**Is my data private?**
Memory is stored locally on your own disk by design, not solely in a vendor
cloud.

**Is this finished / production-ready?**
No — it's an actively developed DIY project. Core features like long-term
memory search and navigation are still being built; treat it as a serious
hobby platform, not a polished appliance (yet).

**How much does it cost to run?**
Hardware is a one-time cost ($79–$149 depending on tier, or free if you
already have the parts). The AI subscription is $19/month for full model
access, or bring your own API key.
