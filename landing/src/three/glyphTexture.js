import * as THREE from "three";
import { BRAND_PATHS } from "./brandPaths";

// Official marks not in simple-icons (trademark policy declines them there),
// sourced directly as real vector paths from each brand's own logo files
// (via Wikimedia Commons) — not simple-icons, but still the real logo.
const CUSTOM_ICONS = {
  chatgpt: {
    viewBox: 20,
    // the OpenAI "flower" symbol (not the OpenAI wordmark)
    path: "M11.248 18.25q-.825 0-1.568-.314a4.3 4.3 0 0 1-1.32-.874 4 4 0 0 1-1.304.214 4 4 0 0 1-2.046-.544 4.27 4.27 0 0 1-1.518-1.485 4 4 0 0 1-.56-2.095q0-.48.131-1.04A4.4 4.4 0 0 1 2.04 10.71a4.07 4.07 0 0 1 .017-3.4 4.2 4.2 0 0 1 1.056-1.418 3.8 3.8 0 0 1 1.6-.842 3.9 3.9 0 0 1 .76-1.683q.593-.759 1.451-1.188a4.04 4.04 0 0 1 1.832-.429q.825 0 1.567.313.742.314 1.32.875a4 4 0 0 1 1.304-.215q1.106 0 2.046.545a4.14 4.14 0 0 1 1.501 1.485q.578.941.578 2.095 0 .48-.132 1.04.66.61 1.023 1.419.363.792.363 1.666 0 .892-.38 1.717a4.3 4.3 0 0 1-1.072 1.435 3.8 3.8 0 0 1-1.584.825 3.8 3.8 0 0 1-.775 1.683 4.06 4.06 0 0 1-1.436 1.188 4.04 4.04 0 0 1-1.832.429m-4.076-2.062q.825 0 1.435-.347l3.103-1.782a.36.36 0 0 0 .164-.313v-1.42L7.881 14.62a.67.67 0 0 1-.726 0l-3.118-1.798a.5.5 0 0 1-.017.115v.198q0 .841.396 1.551.413.693 1.139 1.089a3.2 3.2 0 0 0 1.617.412m.165-2.69a.4.4 0 0 0 .181.05q.083 0 .165-.05l1.238-.71-3.977-2.31a.7.7 0 0 1-.363-.643v-3.58q-.825.362-1.32 1.122a2.9 2.9 0 0 0-.495 1.65q0 .809.413 1.55.412.743 1.072 1.123zm3.91 3.663q.875 0 1.585-.396a2.96 2.96 0 0 0 1.534-2.64v-3.564a.32.32 0 0 0-.165-.297l-1.254-.726v4.604a.7.7 0 0 1-.363.643l-3.119 1.799a3 3 0 0 0 1.783.577m.627-6.039V8.878L10.01 7.822 8.129 8.878v2.244l1.881 1.056zM7.057 5.859a.7.7 0 0 1 .363-.644l3.119-1.798a3 3 0 0 0-1.782-.578q-.874 0-1.584.396A2.96 2.96 0 0 0 6.05 4.324a3.07 3.07 0 0 0-.396 1.551v3.547q0 .199.165.314l1.237.726zm8.383 7.887q.825-.364 1.303-1.123.495-.758.495-1.65a3.15 3.15 0 0 0-.412-1.55q-.413-.743-1.073-1.123l-3.086-1.782q-.099-.065-.181-.049a.3.3 0 0 0-.165.05l-1.238.692 3.993 2.327a.6.6 0 0 1 .264.264.64.64 0 0 1 .1.363zm-3.317-8.382a.63.63 0 0 1 .726 0l3.135 1.831v-.297q0-.792-.396-1.501a2.86 2.86 0 0 0-1.105-1.155q-.71-.43-1.65-.43-.825 0-1.436.347L8.294 5.941a.36.36 0 0 0-.165.314v1.418z",
  },
  grok: {
    // Grok's real two-stroke mark. What was here before was a single
    // straight bar cropped out of the lockup, which on a meteorite face
    // just read as a slash — no one could tell it was a logo at all. This
    // is the actual glyph: the long diagonal blade and the hooked stroke
    // curling under it. Native viewBox is 512×492; the 20px of extra width
    // is close enough to square that centring on 512 is invisible here.
    viewBox: 512,
    fillRule: "evenodd",
    path:
      "M197.76 315.52l170.197-125.803c8.342-6.186 20.267-3.776 24.256 5.803 20.907 50.539 11.563 111.253-30.08 152.939-41.621 41.685-99.562 50.816-152.512 29.994l-57.834 26.816c82.965 56.768 183.701 42.731 246.656-20.33 49.941-50.006 65.408-118.166 50.944-179.627l.128.149c-20.971-90.282 5.162-126.378 58.666-200.17 1.28-1.75 2.56-3.499 3.819-5.291l-70.421 70.507v-.214l-243.883 245.27" +
      "m-35.072 30.528c-59.563-56.96-49.28-145.088 1.515-195.926 37.568-37.61 99.136-52.97 152.874-30.4l57.707-26.666a166.554 166.554 0 00-39.019-21.334 191.467 191.467 0 00-208.042 41.942c-54.038 54.101-71.04 137.301-41.856 208.298 21.802 53.056-13.931 90.582-49.92 128.47C23.104 463.915 10.304 477.333 0 491.541l162.56-145.386",
  },
  glm: {
    viewBox: 30,
    // Z.ai / GLM's real "Z" mark, extracted from their official logo file
    // (Wikimedia Commons) — the rounded-square backdrop is dropped and
    // redrawn via `frame` to match our glowing-outline treatment.
    path:
      "M15.47,7.1l-1.3,1.85c-0.2,0.29-0.54,0.47-0.9,0.47h-7.1V7.09C6.16,7.1,15.47,7.1,15.47,7.1z " +
      "M24.3,7.1L13.14,22.91L5.7,22.91L16.86,7.1Z " +
      "M14.53,22.91l1.31-1.86c0.2-0.29,0.54-0.47,0.9-0.47h7.09v2.33H14.53z",
    frame: true,
  },
};

// Emissive canvas texture for a stone's face: a real brand logo — from the
// simple-icons outlines in brandPaths, or from the brand's own official SVG
// file (CUSTOM_ICONS) where simple-icons declines to carry the mark.
// All 13 models resolve to an actual logo.
export function createGlyphTexture({ id, accent }) {
  const W = 256;
  const H = 256;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = accent;
  ctx.shadowColor = accent;
  ctx.shadowBlur = 28;

  const brand = BRAND_PATHS[id];
  const custom = CUSTOM_ICONS[id];
  const size = 132; // target rendered size in canvas px

  // simple-icons outlines are all drawn on a 24×24 viewBox
  const { path: d, viewBox, frame, fillRule } = brand
    ? { path: brand, viewBox: 24, frame: false }
    : custom;
  const path = new Path2D(d);
  const scale = size / viewBox;
  ctx.save();
  ctx.translate(W / 2 - size / 2, H / 2 - size / 2);
  ctx.scale(scale, scale);
  // marks authored with fill-rule="evenodd" (Grok) fill their counters
  // solid under the canvas default of nonzero
  ctx.fill(path, fillRule ?? "nonzero");
  ctx.restore();

  if (frame) {
    // a rounded-square outline so a single-glyph mark (GLM's Z) still reads
    // as a self-contained app icon, not a stray line
    ctx.save();
    ctx.shadowBlur = 14;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 6;
    ctx.globalAlpha = 0.75;
    const fw = size * 1.18;
    ctx.beginPath();
    ctx.roundRect(W / 2 - fw / 2, H / 2 - fw / 2, fw, fw, fw * 0.22);
    ctx.stroke();
    ctx.restore();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}
