import { useEffect } from 'react';

/*
 * Крайові жести телефона: тяг з лівого краю відкриває шухляду (розмови в
 * чаті, розділи в інших розділах), тяг з правого — закриває її.
 *
 * Свій, а не частина useSwipeNavigation: той ходить МІЖ розділами і навмисно
 * пропускає самі краї (там системний жест «назад»). Цей навпаки живе ТІЛЬКИ
 * в крайовій смузі — і тому вузький (14 px), щоб майже не перейматись із
 * жестом «назад».
 */

/** Ширина крайової смуги, з якої починається жест. */
const EDGE = 14;
/** Мінімальний горизонтальний хід, після якого це вже жест, а не дотик. */
const TRAVEL = 48;

export function useEdgeDrawer(onLeftEdge: () => void, onRightEdge: () => void): void {
  useEffect(() => {
    let startX = 0;
    let startY = 0;
    let tracking = false;

    const down = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (touch.clientX > EDGE && touch.clientX < window.innerWidth - EDGE) {
        tracking = false;
        return;
      }
      startX = touch.clientX;
      startY = touch.clientY;
      tracking = true;
    };

    const end = (event: TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      const touch = event.changedTouches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (Math.abs(dx) < TRAVEL || Math.abs(dx) < Math.abs(dy)) return;
      if (startX <= EDGE && dx > 0) onLeftEdge();
      else if (startX >= window.innerWidth - EDGE && dx < 0) onRightEdge();
    };

    window.addEventListener('touchstart', down, { passive: true });
    window.addEventListener('touchend', end, { passive: true });
    return () => {
      window.removeEventListener('touchstart', down);
      window.removeEventListener('touchend', end);
    };
  }, [onLeftEdge, onRightEdge]);
}
