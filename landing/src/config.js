// ─────────────────────────────────────────────────────────────
//  Claude Bot — landing configuration
//  All tunable constants live here (igloo-style: no magic numbers
//  scattered across components).
// ─────────────────────────────────────────────────────────────

export const BRAND = {
  name: "CLAUDE BOT",
  owner: "WAVE LAB",
  year: 2026,
  domain: "wavelab.inc",
};

// AI models whose meteorites fly in and fuse into the core. Each id maps to
// a brand outline — see BRAND_PATHS (simple-icons marks) and CUSTOM_ICONS
// (OpenAI, xAI/Grok and Z.ai/GLM, which simple-icons won't carry) in
// three/glyphTexture.js.
// `version` is the family's current flagship and `note` is the one thing
// it genuinely leads on — both go on screen when you pick its meteorite.
// Standings are from arena.ai (blind human preference, Elo) and
// Artificial Analysis's Intelligence Index, read 8 Aug 2026. Those two
// disagree by design: Arena measures what people prefer, AA measures what
// scores, so a model can top one and sit mid-table on the other. Recheck
// both when this copy starts to feel old — it dates fast.
export const MODELS = [
  {
    id: "claude",
    name: "Claude",
    version: "Claude Opus 5",
    note: "First on both the Intelligence Index and agentic work. Scored a perfect 42/42 at IMO 2026 with no tools.",
    accent: "#d9a066",
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    version: "GPT-5.6 Sol",
    note: "Second on the Intelligence Index at 61. Tops the academic boards more often than the human-preference ones.",
    accent: "#74e3c3",
  },
  {
    id: "gemini",
    name: "Gemini",
    version: "Gemini 3.1 Pro",
    note: "First on WebDev Arena, and the best model in the field at video — 87.2% on VideoMME.",
    accent: "#8ab4ff",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    version: "DeepSeek V4 Pro",
    note: "MIT-licensed and 80.6% on SWE-bench Verified, matching Gemini 3.1 Pro. V4 Flash is the cheapest usable model anywhere.",
    accent: "#6f8bff",
  },
  {
    id: "qwen",
    name: "Qwen",
    version: "Qwen3.8 Max",
    note: "Sixth on Arena — the highest-placed Chinese model there, above every GPT and Gemini entry.",
    accent: "#a78bff",
  },
  {
    id: "mistral",
    name: "Mistral",
    version: "Mistral Large 3",
    note: "The largest open-weight mixture-of-experts from a major lab: 675B parameters, 41B awake per token.",
    accent: "#ffb35c",
  },
  {
    id: "grok",
    name: "Grok",
    version: "Grok 4.5",
    note: "Third on the Coding Agent Index, level with GPT-5.5 in Codex. Scores 1543 Elo on sustained agentic work.",
    accent: "#cfd6e0",
  },
  {
    id: "glm",
    name: "GLM",
    version: "GLM-5.2",
    note: "First on Design Arena's code boards. 62.1 on SWE-bench Pro at a fifth of frontier cost.",
    accent: "#7fd0ff",
  },
  {
    id: "kimi",
    name: "Kimi",
    version: "Kimi K3",
    note: "The highest-scoring open-weight model on the Intelligence Index, sixth overall at 60.",
    accent: "#b6c2d9",
  },
  {
    id: "perplexity",
    name: "Perplexity",
    version: "Sonar Reasoning Pro",
    note: "Doesn't chase benchmarks. Grounds every answer in live web results instead, and costs a fraction of the frontier.",
    accent: "#5fd0c8",
  },
  {
    id: "minimax",
    name: "MiniMax",
    version: "MiniMax M3",
    note: "59.0 on SWE-bench Pro, past both GPT-5.5 and Gemini 3.1 Pro — with a million-token window and open weights.",
    accent: "#9aa7ff",
  },
  {
    id: "meta",
    name: "Meta",
    version: "Muse Spark 1.2",
    note: "Fourth on Arena, above every GPT and Gemini. Best model in the world on health: 42.8 on HealthBench Hard.",
    accent: "#7aa7ff",
  },
  {
    id: "mimo",
    name: "Xiaomi MiMo",
    version: "MiMo-V2.5-Pro",
    note: "Leads open source on ClawEval at 63.8%, using 40–60% fewer tokens per run than the frontier models.",
    accent: "#ff9a6c",
  },
];

// The tool planets. Each is an MCP server the bot can reach — clicking one
// flies the camera in and opens its dossier, so every field here is copy
// that ends up on screen.
export const TOOLS = [
  {
    id: "mail",
    label: "Mail",
    glyph: "✉",
    server: "mcp://mail",
    accent: "#7fd0ff",
    tagline: "Reads the inbox, drafts the reply, never sends without you.",
    caps: ["Triage unread", "Draft replies", "Extract attachments", "Follow-up reminders"],
  },
  {
    id: "youtube",
    label: "YouTube",
    glyph: "▶",
    server: "mcp://youtube",
    accent: "#ff7b7b",
    tagline: "Watches so you don't have to. Summarises, timestamps, quotes.",
    caps: ["Transcript search", "Chapter summary", "Clip timestamps", "Channel digest"],
  },
  {
    id: "notes",
    label: "Notes",
    glyph: "✎",
    server: "mcp://notes",
    accent: "#ffd479",
    tagline: "A second brain that files itself while you think out loud.",
    caps: ["Capture on speech", "Auto-linking", "Daily log", "Full-text recall"],
  },
  {
    id: "weather",
    label: "Weather",
    glyph: "❄",
    server: "mcp://weather",
    accent: "#a8e6ff",
    tagline: "Knows the sky before you look outside.",
    caps: ["Live conditions", "Hourly forecast", "Storm alerts", "Travel windows"],
  },
  {
    id: "vision",
    label: "Vision",
    glyph: "◎",
    server: "mcp://vision",
    accent: "#c3a0ff",
    tagline: "Point the camera. It sees what you see, and names it.",
    caps: ["Object recall", "Screen reading", "OCR", "Scene description"],
  },
  {
    id: "voice",
    label: "Voice",
    glyph: "◜◝",
    server: "mcp://voice",
    accent: "#74e3c3",
    tagline: "Talks back. Listens first.",
    caps: ["Wake word", "Live transcription", "Natural TTS", "Interrupt-aware"],
  },
  {
    id: "memory",
    label: "Memory",
    glyph: "◉",
    server: "mcp://brain",
    accent: "#ff9a6c",
    tagline: "Remembers you across every session, on your own disk.",
    caps: ["Persistent facts", "People & pets", "Project context", "Local-first"],
  },
  {
    id: "search",
    label: "Web Search",
    glyph: "⌕",
    server: "mcp://search",
    accent: "#9aa7ff",
    tagline: "Goes and finds out, then cites where it looked.",
    caps: ["Live web", "Source citing", "Deep research", "Fact cross-check"],
  },
];

// Slogans etched on the drifting monolith faces.
export const PILLARS = [
  { key: "priorities", title: "Priorities", copy: "You come first. Every cycle serves your intent." },
  { key: "open-source", title: "Open Source", copy: "Blueprints and parts are free. The mind is yours to read." },
  { key: "safety", title: "Safety", copy: "Boundaries by design. It refuses what it shouldn't do." },
  { key: "community", title: "Community", copy: "Built in the open, shaped by the people who run it." },
  { key: "friendly", title: "Friendly", copy: "Cold on the outside. Warm where it counts." },
];

// Which brain the bot ships with. The picker lets you spec the machine
// before you buy it — the price shifts with the board you choose. Specs
// are the actual sensor/output stack a build carries, not marketing chip
// numbers: camera, mic, display, speaker — same parts list as the real
// prototype (see claude-bot-full-spec-v3.md §3).
export const HARDWARE = [
  {
    id: "zero",
    board: "Pi Zero 2 W",
    price: 79,
    specs: ["USB mic + speaker", "No camera", "Cloud vision & STT", "512 MB RAM"],
    note: "The pocket one. No eyes, no local ears — everything thinks in the cloud.",
  },
  {
    id: "pi4",
    board: "Raspberry Pi 4",
    price: 119,
    specs: [
      "OV5647 camera (CSI)",
      "USB mic array",
      "2.4\" SPI touch display",
      "I2S speaker (MAX98357A)",
    ],
    note: "The balanced one. Hears and sees without asking the network.",
    popular: true,
  },
  {
    id: "pi5",
    board: "Raspberry Pi 5",
    price: 149,
    specs: [
      "Everything in Pi 4",
      "Local Whisper STT",
      "Face recognition",
      "HC-SR04 distance sensing",
    ],
    note: "The whole brain, offline. Nothing ever leaves the house.",
  },
];

export const PRICING = [
  {
    id: "diy",
    kicker: "Open source",
    title: "Blueprints & Parts",
    price: "Free",
    unit: "forever",
    desc: "Every schematic, model and part list. Build it yourself.",
    features: ["Full schematics", "Bill of materials", "Firmware source", "Community support"],
    cta: "Get the blueprints",
  },
  {
    id: "ai",
    kicker: "Intelligence",
    title: "AI Subscription",
    price: "$19",
    unit: "/ month",
    desc: "We are the provider too. One key, all thirteen models.",
    features: ["All models, one key", "Unlimited routing", "Priority latency", "Cancel anytime"],
    highlight: true,
    cta: "Power it up",
  },
];

// Cold, desaturated blue-grey palette (see how-igloo-inc-works §3).
export const COLORS = {
  bg: "#05070b",
  bgSoft: "#0a0e15",
  ink: "#c3ccda",
  inkDim: "#6b7789",
  line: "#1b232f",
  stone: "#20262f",
  stoneEdge: "#4a5666",
  rim: "#9fb6d6",
  accent: "#7fd0ff",
  fog: "#0a0f16",
};

// Scroll layout — number of scrollable "pages" (viewport heights). One per
// overlay block: hero, tools, pillars, pricing, tail.
export const SCROLL_PAGES = 5;

// Where each act of the scroll lives, as a 0..1 fraction of the whole
// track. Keeping these in one place means the scene and the HTML overlays
// can never drift out of sync.
// With SCROLL_PAGES=5 the track is 500vh tall and scrolls 400vh, so each
// 100vh overlay block lands at a fixed offset: block N is centred at
// (N-1)/4. These ranges are pinned to that grid — the camera arrives at an
// act exactly when its copy fills the frame.
// `pillars` is deliberately wide: it isn't a place the camera stops but a
// descent it makes, meeting one slab at a time across the whole range.
export const ACTS = {
  fusion: [0.0, 0.12], //  meteorites converge into the core  (block 1 @ 0.00)
  // Starts where the camera starts moving (FUSION_HOLD), not where it
  // arrives: the fusion cluster dissolves as you leave it and the asteroid
  // ring slides in while you're still on the way down. Held at 0.22 — the
  // old arrival point — the descent crossed an empty frame, the fusion
  // already gone and the ring not yet allowed to show itself.
  tools: [0.19, 0.32], //  asteroid tool bodies, clickable    (block 2 @ 0.25)
  pillars: [0.4, 0.63], //  carved slabs: what it stands for  (block 3 @ 0.50)
  pricing: [0.72, 0.82], // spec the machine, pick a plan     (block 4 @ 0.75)
};

// The fusion doesn't hand straight over to the next act the instant the
// last meteorite lands. It holds: from ACTS.fusion[1] to FUSION_HOLD the
// camera does not move at all, so the assembled cluster and its wordmark
// get a beat of their own — roughly 28vh of wheel where the only thing
// happening is the cluster breathing on its idle orbits.
//
// This used to be the worst moment on the page. Fusion finished at 0.20 and
// the camera ran its ENTIRE descent to the tools act between 0.20 and 0.22
// — 2% of the track, about 8vh of wheel for a 16-unit move — so the payoff
// frame existed for a couple of wheel notches and then the view snapped
// away. It read as the scroll skipping, not as a transition.
export const FUSION_HOLD = 0.19;

// Where the camera finishes its descent into the tools act. Deliberately
// the tools block's own offset (block 2 @ 0.25), not ACTS.tools[0]: the
// bodies start fading in at 0.22 while the camera is still on its way
// down, so you arrive to a ring that's already there rather than watching
// it pop in on landing.
export const TOOLS_ARRIVE = 0.25;
