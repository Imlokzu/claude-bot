import { useEffect, useState } from 'react';
import { useTheme } from './useTheme';

/*
 * Читання токенів як ОБЧИСЛЕНИХ значень.
 *
 * Потрібне не всюди, а там, де колір іде в canvas: DotGrid і PixelCard
 * підставляють його в `ctx.fillStyle`, а полотно рядка `var(--c-border)`
 * не розуміє — воно мовчки лишає попередній колір, і ефект просто зникає.
 * Компоненти, що малюють через DOM/SVG (тости, підказки, перемикачі),
 * приймають `var(...)` як є, і для них цей гак не потрібен.
 */

function read(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/** Один токен обчисленим значенням; оновлюється при зміні теми чи акценту. */
export function useCssVar(name: string, fallback = ''): string {
  const { resolved, accent } = useTheme();
  const [value, setValue] = useState(() => read(name, fallback));

  useEffect(() => {
    setValue(read(name, fallback));
  }, [name, fallback, resolved, accent]);

  return value;
}

/** Акцент готовим css-кольором (#rrggbb). */
export const useAccentColor = () => useCssVar('--c-accent', '#b95f3d');

/**
 * Акцент трійкою "R, G, B" — саме таку форму очікують ефекти MagicBento:
 * вони складають із неї rgba() самі.
 */
export const useAccentRgb = () => useCssVar('--c-accent-rgb', '185, 95, 61');
