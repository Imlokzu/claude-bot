// Decimates and Draco-packs the Poly Haven rock scans for the web.
//
// The raw scans are ~6.1 MB of geometry for bodies that render about 60 px
// tall in the fusion act. At that size the extra half-million triangles are
// invisible, so we simplify hard and compress what's left: 6.1 MB → 772 KB.
//
// Usage:
//   1. download the source scans into .assets-cache/rocks/<id>/<id>.gltf
//      (Poly Haven → Models → Download → glTF, CC0)
//   2. node scripts/optimize-rocks.mjs
//
// Output lands in public/models/rocks-opt/<id>.glb, which is what
// three/StoneField.jsx loads.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";

const SRC = ".assets-cache/rocks";
const OUT = "public/models/rocks-opt";
const IDS = ["boulder_01", "rock_09", "namaqualand_boulder_03"];

// ratio 0.08 keeps the silhouette — which is all you can read at this scale
// — while dropping 92% of the triangles.
const ARGS = [
  "--simplify", "true",
  "--simplify-ratio", "0.08",
  "--simplify-error", "0.01",
  "--compress", "draco",
  "--texture-compress", "webp",
  "--texture-size", "512",
];

if (!existsSync(SRC)) {
  console.error(`missing ${SRC} — see the header of this file for what to put there`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

for (const id of IDS) {
  const input = `${SRC}/${id}/${id}.gltf`;
  if (!existsSync(input)) {
    console.error(`skipping ${id}: no ${input}`);
    continue;
  }
  execFileSync("npx", ["--no-install", "gltf-transform", "optimize", input, `${OUT}/${id}.glb`, ...ARGS], {
    stdio: "inherit",
  });
  console.log(`✓ ${id}`);
}
