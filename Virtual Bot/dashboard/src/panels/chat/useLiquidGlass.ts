import { useEffect, type RefObject } from 'react';
import '@/vendor/hyalite/hyalite.js';
import type { HyaliteOptions } from '@/vendor/hyalite/hyalite.js';

/*
 * The chat plates are a lens, not a tint. Hyalite (MIT, vendored) builds a
 * refraction map for each plate and bends whatever is behind the rim.
 * Chromium is the only engine that paints an SVG backdrop filter; everywhere
 * else the CSS fallback in vendor.css keeps the bright rim and a small blur.
 *
 * Tuned on a dark chat: a narrow bevel so the words stay straight, a hard
 * pull so the rim still bends, and almost no colour split — a wide
 * dispersion turns the line under the composer into a rainbow smear.
 */
const lens: HyaliteOptions = {
  bevel: 9,
  thickness: 54,
  slope: 1.55,
  shape: 'squircle',
  blur: 0,
  dispersion: 0,
  shade: 0.34,
  rim: 2.3,
  edgeW: 6,
  sat: 0.95,
  edge: 1.05,
  light: -16,
  smooth: 0,
  settle: 0,
};

export function useLiquidGlass(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    const Hyalite = window.Hyalite;
    if (!el || !Hyalite?.supported()) return;
    if (window.matchMedia('(prefers-reduced-transparency: reduce)').matches) return;
    // The lens sits on a plate behind the field, never on the field itself.
    // The SVG filter clips the element it is attached to, and that was
    // cutting a tall draft down to its last line.
    const field = Hyalite.watch(el, '.liquid-glass-plate', { ...lens, dispersion: 0.45 });
    const circle = Hyalite.watch(el, '.chat-scroll-latest', {
      ...lens,
      bevel: 18,
      thickness: 48,
      dispersion: 0.4,
    });
    return () => {
      field.stop();
      circle.stop();
    };
  }, [root]);
}
