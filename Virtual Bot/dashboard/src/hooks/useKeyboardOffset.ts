import { useEffect } from 'react';

/*
 * Висота екранної клавіатури як CSS-змінна `--kb`.
 *
 * На телефоні клавіатура не зменшує вікно (особливо Chrome/Android), тож
 * поле вводу внизу опиняється ПІД нею. Слухаємо visualViewport: різниця
 * між повною висотою вікна й видимою частиною — це і є клавіатура.
 * Скрол теж зсуває видиму частину, тому відсікаємо дребізд до 80 px:
 * менше — це адресний рядок чи жест, а не клавіатура.
 */
export function useKeyboardOffset(): void {
  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    if (!viewport) return undefined;

    let frame = 0;
    const apply = () => {
      frame = 0;
      const inset = window.innerHeight - viewport.height - viewport.offsetTop;
      root.style.setProperty('--kb', `${Math.max(0, Math.round(inset))}px`);
      root.toggleAttribute('data-kb', inset > 80);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };

    schedule();
    viewport.addEventListener('resize', schedule);
    viewport.addEventListener('scroll', schedule);
    return () => {
      viewport.removeEventListener('resize', schedule);
      viewport.removeEventListener('scroll', schedule);
      if (frame) cancelAnimationFrame(frame);
      root.style.setProperty('--kb', '0px');
      root.removeAttribute('data-kb');
    };
  }, []);
}
