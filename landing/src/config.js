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
export const MODELS = [
  { id: "claude", name: "Claude", accent: "#d9a066" },
  { id: "chatgpt", name: "ChatGPT", accent: "#74e3c3" },
  { id: "gemini", name: "Gemini", accent: "#8ab4ff" },
  { id: "deepseek", name: "DeepSeek", accent: "#6f8bff" },
  { id: "qwen", name: "Qwen", accent: "#a78bff" },
  { id: "mistral", name: "Mistral", accent: "#ffb35c" },
  { id: "grok", name: "Grok", accent: "#cfd6e0" },
  { id: "glm", name: "GLM", accent: "#7fd0ff" },
  { id: "kimi", name: "Kimi", accent: "#b6c2d9" },
  { id: "perplexity", name: "Perplexity", accent: "#5fd0c8" },
  { id: "minimax", name: "MiniMax", accent: "#9aa7ff" },
  { id: "meta", name: "Meta", accent: "#7aa7ff" },
  { id: "mimo", name: "Xiaomi MiMo", accent: "#ff9a6c" },
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
// before you buy it — the price shifts with the board you choose.
export const HARDWARE = [
  {
    id: "zero",
    board: "Pi Zero 2 W",
    price: 79,
    specs: ["512 MB RAM", "Quad-core 1 GHz", "Cloud inference"],
    note: "The pocket one. Tiny body, everything thinks in the cloud.",
  },
  {
    id: "pi4",
    board: "Raspberry Pi 4",
    price: 119,
    specs: ["4 GB RAM", "Quad-core 1.8 GHz", "Voice + vision on-device"],
    note: "The balanced one. Hears and sees without asking the network.",
    popular: true,
  },
  {
    id: "pi5",
    board: "Raspberry Pi 5",
    price: 149,
    specs: ["8 GB RAM", "Quad-core 2.4 GHz", "Full local inference"],
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
  fusion: [0.0, 0.2], //   meteorites converge into the core  (block 1 @ 0.00)
  tools: [0.22, 0.32], //  asteroid tool bodies, clickable    (block 2 @ 0.25)
  pillars: [0.4, 0.63], //  carved slabs: what it stands for  (block 3 @ 0.50)
  pricing: [0.72, 0.82], // spec the machine, pick a plan     (block 4 @ 0.75)
};
