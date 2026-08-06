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

// AI models whose "stones" fly in and fuse into the monolith.
// icon = simple-icons export key (real brand logo, drawn from its SVG path).
// label = unicode glyph fallback for brands simple-icons won't ship
// (OpenAI, xAI/Grok and Zhipu/GLM decline inclusion under its trademark policy).
export const MODELS = [
  { id: "claude", icon: "siClaude", label: "✳", name: "Claude", accent: "#d9a066" },
  { id: "chatgpt", label: "◍", name: "ChatGPT", accent: "#74e3c3" },
  { id: "gemini", icon: "siGooglegemini", label: "✧", name: "Gemini", accent: "#8ab4ff" },
  { id: "deepseek", icon: "siDeepseek", label: "⌖", name: "DeepSeek", accent: "#6f8bff" },
  { id: "qwen", icon: "siQwen", label: "❖", name: "Qwen", accent: "#a78bff" },
  { id: "mistral", icon: "siMistralai", label: "▲", name: "Mistral", accent: "#ffb35c" },
  { id: "grok", label: "𝕏", name: "Grok", accent: "#cfd6e0" },
  { id: "glm", label: "◆", name: "GLM", accent: "#7fd0ff" },
  { id: "kimi", icon: "siKimi", label: "☾", name: "Kimi", accent: "#b6c2d9" },
  { id: "perplexity", icon: "siPerplexity", label: "≈", name: "Perplexity", accent: "#5fd0c8" },
  { id: "minimax", icon: "siMinimax", label: "⬡", name: "MiniMax", accent: "#9aa7ff" },
  { id: "meta", icon: "siMeta", label: "∞", name: "Meta", accent: "#7aa7ff" },
  { id: "mimo", icon: "siXiaomi", label: "◐", name: "Xiaomi MiMo", accent: "#ff9a6c" },
];

// Everyday tools the bot unifies (rendered as an icon grid).
export const TOOLS = [
  { id: "mail", label: "Mail", glyph: "✉" },
  { id: "youtube", label: "YouTube", glyph: "▶" },
  { id: "notes", label: "Notes", glyph: "✎" },
  { id: "weather", label: "Weather", glyph: "❄" },
  { id: "calendar", label: "Calendar", glyph: "▦" },
  { id: "memory", label: "Memory", glyph: "◉" },
  { id: "vision", label: "Vision", glyph: "◎" },
  { id: "voice", label: "Voice", glyph: "◜◝" },
  { id: "search", label: "Web Search", glyph: "⌕" },
  { id: "code", label: "Code", glyph: "⌘" },
  { id: "files", label: "Files", glyph: "▤" },
  { id: "music", label: "Music", glyph: "♪" },
];

// Slogans etched on the drifting monolith faces.
export const PILLARS = [
  { key: "priorities", title: "Priorities", copy: "You come first. Every cycle serves your intent." },
  { key: "open-source", title: "Open Source", copy: "Blueprints and parts are free. The mind is yours to read." },
  { key: "safety", title: "Safety", copy: "Boundaries by design. It refuses what it shouldn't do." },
  { key: "community", title: "Community", copy: "Built in the open, shaped by the people who run it." },
  { key: "friendly", title: "Friendly", copy: "Cold on the outside. Warm where it counts." },
];

export const PRICING = [
  {
    id: "unit",
    kicker: "Hardware",
    title: "Buy the Bot",
    price: "$1,290",
    unit: "one-time",
    desc: "The finished machine. Assembled, calibrated, ready to wake.",
    features: ["Assembled unit", "Calibrated sensors", "1-year warranty", "Free OTA updates"],
    highlight: false,
    cta: "Order a unit",
  },
  {
    id: "diy",
    kicker: "Open source",
    title: "Blueprints & Parts",
    price: "Free",
    unit: "forever",
    desc: "Every schematic, model and part list. Build it yourself.",
    features: ["Full schematics", "Bill of materials", "Firmware source", "Community support"],
    highlight: true,
    cta: "Get the blueprints",
  },
  {
    id: "ai",
    kicker: "Intelligence",
    title: "AI Subscription",
    price: "$19",
    unit: "/ month",
    desc: "We are also the provider. One key, every frontier model.",
    features: ["All models, one key", "Unlimited routing", "Priority latency", "Cancel anytime"],
    highlight: false,
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

// Scroll layout — number of scrollable "pages" (viewport heights).
// kept short while only the fusion stage exists — each wheel tick should
// carry real distance. Raise this as later sections (tools, pillars,
// pricing) get built and need their own scroll range.
export const SCROLL_PAGES = 3;
