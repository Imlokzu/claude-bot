// Regenerates src/three/brandPaths.js from simple-icons.
//
// simple-icons ships no per-icon entry points, so importing it at runtime
// drags all ~3,450 marks into the bundle (5.6 MB). We only draw ten, so we
// lift their outlines at authoring time instead.
//
// Usage:  npm i -D simple-icons && node scripts/extract-icons.mjs
//
// Marks are CC0; the file it writes is checked in, so simple-icons is not
// a runtime dependency.

import { writeFileSync } from "node:fs";
import * as simpleIcons from "simple-icons";

// simple-icons export key → our model id in config.js
const WANTED = {
  siClaude: "claude",
  siGooglegemini: "gemini",
  siDeepseek: "deepseek",
  siQwen: "qwen",
  siMistralai: "mistral",
  siKimi: "kimi",
  siPerplexity: "perplexity",
  siMinimax: "minimax",
  siMeta: "meta",
  siXiaomi: "mimo",
};

const missing = Object.keys(WANTED).filter((k) => !simpleIcons[k]);
if (missing.length) {
  console.error("simple-icons no longer exports:", missing.join(", "));
  process.exit(1);
}

const body = Object.entries(WANTED)
  .map(([key, id]) => `  // ${simpleIcons[key].title}\n  ${id}: "${simpleIcons[key].path}",`)
  .join("\n");

const header = `// Brand mark outlines, lifted from simple-icons (CC0) at build-authoring
// time rather than imported from the package.
//
// The package has no per-icon entry points, so \`import * as simpleIcons\`
// pulled all ~3,450 marks into the bundle — 5.6 MB of the 6.9 MB total for
// the ten we actually draw. These are those ten, keyed by model id.
//
// To refresh: npm i simple-icons, then re-run scripts/extract-icons.mjs

export const BRAND_PATHS = {
`;

writeFileSync("src/three/brandPaths.js", header + body + "\n};\n");
console.log(`wrote src/three/brandPaths.js (${Object.keys(WANTED).length} marks)`);
