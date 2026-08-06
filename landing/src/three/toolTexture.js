import * as THREE from "three";

// A survey annotation pinned to a body — leader line, tick, then the
// readout. This is igloo's language (its stones carry "27", "45" tags on
// hairlines), turned into something with real content: the tool, its MCP
// address, and the NASA designation of the actual asteroid you're looking at.
//
// `flip` puts the anchor on the right and right-aligns the copy, so a body
// sitting on the right of frame points its leader line inward instead of
// running off the edge. The text itself is never mirrored — it's laid out
// from the other side, which is why this draws two compositions rather
// than transforming one.
export function createToolTexture({ glyph, label, server, accent, designation, flip = false }) {
  // 2K canvas: the plate is large in world space, so a 1K texture left the
  // secondary lines soft once depth-of-field was in the stack
  const W = 2048;
  const H = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, W, H);

  const anchorX = flip ? W - 80 : 80;
  const anchorY = H * 0.66;
  const elbowX = flip ? W - 420 : 420;
  const elbowY = H * 0.4;
  const railEnd = flip ? 120 : W - 120;

  // leader line: diagonal off the body, then a long horizontal rule
  ctx.strokeStyle = "rgba(190,208,230,0.5)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(anchorX, anchorY);
  ctx.lineTo(elbowX, elbowY);
  ctx.lineTo(railEnd, elbowY);
  ctx.stroke();

  // anchor cross where it meets the body
  ctx.strokeStyle = accent;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(anchorX - 22, anchorY);
  ctx.lineTo(anchorX + 22, anchorY);
  ctx.moveTo(anchorX, anchorY - 22);
  ctx.lineTo(anchorX, anchorY + 22);
  ctx.stroke();

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = flip ? "right" : "left";

  // copy runs away from the elbow, toward the far end of the rule
  const dir = flip ? -1 : 1;
  const x0 = elbowX + dir * 40;

  // tool name — the loud line
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(200,220,245,0.6)";
  ctx.shadowBlur = 30;
  ctx.font = "700 132px 'IBM Plex Mono', monospace";
  ctx.fillText(label.toUpperCase(), x0, elbowY - 54);
  ctx.shadowBlur = 0;

  // glyph tucked past the name, on the same baseline
  const nameW = ctx.measureText(label.toUpperCase()).width;
  ctx.fillStyle = accent;
  ctx.shadowColor = accent;
  ctx.shadowBlur = 40;
  ctx.font = "600 132px system-ui, 'Apple Color Emoji', sans-serif";
  ctx.fillText(glyph, x0 + dir * (nameW + 52), elbowY - 54);
  ctx.shadowBlur = 0;

  // mcp address beneath the rule
  ctx.fillStyle = accent;
  ctx.font = "600 62px 'IBM Plex Mono', monospace";
  ctx.fillText(server, x0, elbowY + 96);

  // the real body this is riding on — the detail nobody else has
  ctx.fillStyle = "rgba(180,200,224,0.72)";
  ctx.font = "500 48px 'IBM Plex Mono', monospace";
  ctx.fillText(`BODY ${designation}`, x0, elbowY + 170);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}
