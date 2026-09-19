import { useCallback, useEffect, useState } from 'react';

/*
 * З якого краю стоїть док.
 *
 * Зберігаємо поруч із темою й акцентом — це така сама особиста звичка:
 * лівші й правші тримають руку по-різному, а на широкому екрані нижній край
 * забирає найдорожче місце (там закінчується текст).
 */

export type DockSide = 'bottom' | 'top' | 'left' | 'right';

const KEY = 'claudeBotDockSide';
const SIDES: DockSide[] = ['bottom', 'top', 'left', 'right'];

function read(): DockSide {
  try {
    const saved = localStorage.getItem(KEY) as DockSide | null;
    return saved && SIDES.includes(saved) ? saved : 'bottom';
  } catch {
    // Приватне вікно або заблокована памʼять сайту — це не привід падати.
    return 'bottom';
  }
}

export function useDockSide(): [DockSide, (side: DockSide) => void] {
  const [side, setSide] = useState<DockSide>(read);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, side);
    } catch {
      /* див. вище */
    }
    // Розділам треба знати, з якого боку лишати місце: док плаває НАД ними.
    document.documentElement.setAttribute('data-dock', side);
  }, [side]);

  return [side, useCallback((next: DockSide) => setSide(next), [])];
}

/** Найближчий край до точки — куди док прилипне, коли його відпустять. */
export function nearestSide(x: number, y: number): DockSide {
  const { innerWidth: w, innerHeight: h } = window;
  const distances: [DockSide, number][] = [
    ['left', x],
    ['right', w - x],
    ['top', y],
    ['bottom', h - y],
  ];
  distances.sort((a, b) => a[1] - b[1]);
  return distances[0][0];
}
