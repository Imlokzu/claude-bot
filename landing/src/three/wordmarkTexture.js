import * as THREE from "three";

// Reusable canvas texture for a short headline/wordmark, rendered once onto
// a plane. Cheap and reliable (avoids 3D font loading entirely).
export function createWordmarkTexture(text, { size = 120, sub = "" } = {}) {
  const W = 1024;
  const H = 320;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, W, H);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#eaf1fb";
  ctx.shadowColor = "rgba(159,182,214,0.55)";
  ctx.shadowBlur = 22;
  ctx.font = `600 ${size}px "IBM Plex Mono", monospace`;
  ctx.fillText(text, W / 2, sub ? H / 2 - 26 : H / 2);

  if (sub) {
    ctx.shadowBlur = 8;
    ctx.fillStyle = "rgba(159,182,214,0.85)";
    ctx.font = `500 28px "IBM Plex Mono", monospace`;
    ctx.fillText(sub, W / 2, H / 2 + 48);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return { texture, aspect: W / H };
}
