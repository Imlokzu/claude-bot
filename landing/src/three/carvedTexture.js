import * as THREE from "three";

// Text cut *into* stone rather than printed on it. The trick is two
// offset copies: a dark one pushed down-right for the shadow inside the
// groove, and a light one pushed up-left for the lip catching the light.
// Together they read as depth without any actual displacement geometry.
export function createCarvedTexture({ title, copy, index, accent }) {
  const W = 1024;
  const H = 512;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  ctx.clearRect(0, 0, W, H);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  const x = 70;

  // section index, small and cool — a mason's mark
  ctx.font = "500 30px 'IBM Plex Mono', monospace";
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillText(index, x + 2, 122);
  ctx.fillStyle = accent;
  ctx.fillText(index, x, 120);

  // the word itself, carved
  const carve = (text, font, baseline, light, dark) => {
    ctx.font = font;
    ctx.fillStyle = dark;
    ctx.fillText(text, x + 3, baseline + 3); // groove shadow
    ctx.fillStyle = light;
    ctx.fillText(text, x - 1, baseline - 1); // lit lip
  };

  carve(
    title.toUpperCase(),
    "700 118px 'IBM Plex Mono', monospace",
    250,
    "rgba(228,238,250,0.92)",
    "rgba(0,0,0,0.72)"
  );

  // rule under the word
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(x, 288, W - x * 2, 3);
  ctx.fillStyle = "rgba(190,210,235,0.35)";
  ctx.fillRect(x, 286, W - x * 2, 2);

  // the sentence stays off the stone now — it lives in the floating label
  // beside it instead, so the carving itself doesn't duplicate that copy
  // and turn into a wall of text at close range
  if (copy) {
    ctx.font = "500 42px 'IBM Plex Mono', monospace";
    const words = copy.split(" ");
    const lines = [];
    let line = "";
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (ctx.measureText(next).width > W - x * 2 && line) {
        lines.push(line);
        line = w;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);

    lines.slice(0, 3).forEach((l, i) => {
      const y = 362 + i * 56;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillText(l, x + 2, y + 2);
      ctx.fillStyle = "rgba(196,212,232,0.78)";
      ctx.fillText(l, x, y);
    });
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}
