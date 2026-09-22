import { useEffect, useRef, useState } from 'react';
import type { TouchEvent as ReactTouchEvent } from 'react';

/*
 * Ліва шухляда (розмови, розділи на телефоні).
 *
 * Своя, а не Dialog: Dialog перекриває весь екран вуаллю і чекає кліку по
 * кнопці закриття, а шухляда має їздити за пальцем і закриватись свайпом
 * убік. Правила взяті з нативних: тягнемо лише за головку або за край,
 * жест швидше за 0.35 px/мс рахується «кинутою» навіть не долетівши.
 */

/** Скільки треба протягнути, щоб шухляда закрилась (px). */
const CLOSE_AFTER = 96;

export function useDrawer() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; lastX: number; lastT: number } | null>(null);

  /* Escape закриває — як і будь-який наш діалог. */
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  /* Поки шухляда відкрита, сторінка під нею не скролиться. */
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const settle = () => {
    const panel = panelRef.current;
    if (panel) panel.style.transform = '';
    drag.current = null;
  };

  const onTouchStart = (event: ReactTouchEvent) => {
    const touch = event.touches[0];
    drag.current = { startX: touch.clientX, lastX: touch.clientX, lastT: performance.now() };
  };

  const onTouchMove = (event: ReactTouchEvent) => {
    const state = drag.current;
    const panel = panelRef.current;
    if (!state || !panel) return;
    const touch = event.touches[0];
    state.lastX = touch.clientX;
    state.lastT = performance.now();
    /* Вправо шухляда не їде: вона прибита до лівого краю. */
    panel.style.transform = `translateX(${Math.min(0, touch.clientX - state.startX)}px)`;
    panel.style.transition = 'none';
  };

  const onTouchEnd = () => {
    const state = drag.current;
    if (!state) return;
    const distance = state.lastX - state.startX;
    const panel = panelRef.current;
    if (panel) panel.style.transition = '';
    if (distance < -CLOSE_AFTER) setOpen(false);
    settle();
  };

  const veilProps = {
    onClick: () => setOpen(false),
    'aria-hidden': true as const,
  };

  const panelProps = {
    ref: panelRef,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel: settle,
    role: 'dialog' as const,
    'aria-modal': true as const,
  };

  return { open, setOpen, veilProps, panelProps };
}
