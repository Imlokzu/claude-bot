import { useEffect, useRef, useState } from 'react';
import { useTheme } from '@/hooks/useTheme';

/*
 * The clock tile from /screen (page 2), ported as-is: the same 3x5 pixel
 * digits and the same blinking colon, drawn in the crab's accent colour with a
 * darker drop so it reads as one of the crab's own glyphs.
 * Source: static/screen/pixel-ui.js (GLYPHS, drawGlyphString).
 */

const GLYPHS: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '001', '001', '001'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  ':': ['0', '1', '0', '1', '0'],
};

function drawGlyphs(ctx: CanvasRenderingContext2D, text: string, body: string, shadow: string, skip: string) {
  const { width: W, height: H } = ctx.canvas;
  const chars = text.split('');
  let cols = 0;
  for (const ch of chars) cols += (GLYPHS[ch]?.[0].length ?? -1) + 1;
  cols = Math.max(1, cols - 1);
  const s = Math.floor(Math.min(W / cols, H / 6));
  const depth = Math.max(2, Math.round(s / 6));
  let x = Math.floor((W - cols * s) / 2);
  const y = Math.floor((H - 5 * s) / 2);
  ctx.clearRect(0, 0, W, H);
  for (const ch of chars) {
    const glyph = GLYPHS[ch];
    if (!glyph) continue;
    if (!skip.includes(ch)) {
      glyph.forEach((row, r) => [...row].forEach((bit, c) => {
        if (bit !== '1') return;
        ctx.fillStyle = shadow;
        ctx.fillRect(x + c * s, y + r * s + depth, s, s);
        ctx.fillStyle = body;
        ctx.fillRect(x + c * s, y + r * s, s, s);
      }));
    }
    x += (glyph[0].length + 1) * s;
  }
}

/** Canvas fillStyle cannot be trusted with color-mix(); let the browser resolve it to rgb(). */
function resolveColor(css: string): string {
  const probe = document.createElement('span');
  probe.style.color = css;
  document.body.appendChild(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  return value || css;
}

const two = (n: number) => String(n).padStart(2, '0');

export function ClockPin() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { resolved, accent } = useTheme();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const [colors, setColors] = useState({ body: '#d98263', shadow: '#8a4c36' });
  useEffect(() => {
    const body = getComputedStyle(document.documentElement).getPropertyValue('--c-accent').trim() || '#d98263';
    setColors({ body, shadow: resolveColor(`color-mix(in oklab, ${body} 62%, #000)`) });
  }, [resolved, accent]);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const hhmm = `${two(now.getHours())}:${two(now.getMinutes())}`;
    drawGlyphs(ctx, hhmm, colors.body, colors.shadow, now.getSeconds() % 2 === 0 ? '' : ':');
  }, [now, colors]);

  const lang = document.documentElement.lang || 'uk';
  const date = new Intl.DateTimeFormat(lang, { weekday: 'long', day: 'numeric', month: 'long' }).format(now);
  const label = new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' }).format(now);

  return (
    <div className="flex flex-col items-center py-1">
      <canvas ref={canvasRef} width={288} height={96} role="img" aria-label={label}
              className="block h-auto w-full max-w-[216px] [image-rendering:pixelated]" />
      <p className="mt-1 text-[12px] text-ink-3">{date}</p>
    </div>
  );
}
