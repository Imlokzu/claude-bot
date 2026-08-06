import * as THREE from "three";

// Draws the green-phosphor boot terminal onto an offscreen canvas and
// hands back a THREE texture we can map onto the CRT glass.

export function createTerminalTexture() {
  const W = 1024;
  const H = 768; // 4:3, matches a CRT tube
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.flipY = true;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  const FONT = 30;
  const LH = 40; // line height
  const PAD = 40;
  const MAXLINES = Math.floor((H - PAD * 2) / LH);

  function draw(state) {
    const { lines, typed, phase, command, prompt, t = 0 } = state;

    // background: deep phosphor black
    ctx.fillStyle = "#010a05";
    ctx.fillRect(0, 0, W, H);

    ctx.font = `600 ${FONT}px "IBM Plex Mono", monospace`;
    ctx.textBaseline = "top";

    // assemble rows: log lines, then (while typing) the command row
    const rows = [];
    for (const l of lines) rows.push({ ts: `[${l.t}]`, msg: l.msg, kind: l.kind });
    if (phase === "typing") {
      rows.push({
        cmd: true,
        prompt,
        typed,
        caret: Math.floor(t * 2) % 2 === 0,
      });
    } else if (lines.length) {
      // trailing cursor
      rows.push({ raw: "█", kind: "cur", blink: Math.floor(t * 2) % 2 === 0 });
    }

    const view = rows.slice(-MAXLINES);
    let y = PAD;
    for (const r of view) {
      if (r.cmd) {
        let x = PAD;
        ctx.fillStyle = "#43ff86";
        ctx.fillText(r.prompt, x, y);
        x += ctx.measureText(r.prompt).width;
        ctx.fillStyle = "#2fae63";
        ctx.fillText(" # ", x, y);
        x += ctx.measureText(" # ").width;
        ctx.fillStyle = "#d6ffe6";
        ctx.fillText(r.typed, x, y);
        x += ctx.measureText(r.typed).width;
        if (r.caret) {
          ctx.fillStyle = "#b6ffd0";
          ctx.fillText("█", x, y);
        }
      } else if (r.raw) {
        if (r.blink) {
          ctx.fillStyle = "#b6ffd0";
          ctx.fillText(r.raw, PAD, y);
        }
      } else {
        // timestamp (dim) + message (bright/kern)
        ctx.fillStyle = "rgba(47,174,99,0.75)";
        ctx.fillText(r.ts, PAD, y);
        const mx = PAD + ctx.measureText(r.ts + " ").width;
        ctx.fillStyle =
          r.kind === "ok"
            ? "#43ff86"
            : r.kind === "svc"
            ? "#b7ffcf"
            : "rgba(125,255,174,0.72)";
        // clip overly long lines to the tube width
        let msg = r.msg;
        while (msg.length && mx + ctx.measureText(msg).width > W - PAD) {
          msg = msg.slice(0, -2);
        }
        ctx.fillText(msg, mx, y);
      }
      y += LH;
    }

    // faint scanlines baked into the texture
    ctx.fillStyle = "rgba(0,0,0,0.16)";
    for (let sy = 0; sy < H; sy += 4) ctx.fillRect(0, sy, W, 2);

    texture.needsUpdate = true;
  }

  return { texture, draw, dispose: () => texture.dispose() };
}
