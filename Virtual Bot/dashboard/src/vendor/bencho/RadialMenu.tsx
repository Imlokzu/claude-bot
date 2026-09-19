import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import './RadialMenu.css';

/*
 * Радіальне меню — блок «Radial menu» з bencho.dev (MIT).
 *
 * Джерело коду закрите (github.com/lorenzo04us/Bencho, src/lab/GlassKit.tsx —
 * недоступний), тому це складено за опублікованими там API та розбором
 * механіки. Збережено головне, заради чого воно й потрібне:
 *
 *   «Відкрити, вибрати й підтвердити — це ОДИН жест: натиснув, повів у бік
 *    потрібного, відпустив. Ні другого дотику, ні дороги назад до меню, що
 *    відкрилось десь інде.»
 *
 * Звичайний клік теж працює й лишає меню відкритим — не кожен здогадається
 * про перетягування. Мертва зона 14 px відрізняє клік від жесту.
 *
 * Пропси — ті самі, що на сайті: count (тут задається довжиною `items`),
 * stagger, radius, spread. Додано `bias`: там віялка завжди дивиться вгору
 * півколом, а наша кнопка стоїть біля лівого краю поля вводу, і ліва
 * половина дуги пішла б за екран.
 */

export interface RadialItem {
  key: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
}

export interface RadialMenuProps {
  items: RadialItem[];
  /** Сходинка затримки між пунктами, мс (0–70). */
  stagger?: number;
  /** Радіус віялки, px (44–104). */
  radius?: number;
  /** Розкрив дуги, градуси (60–300). */
  spread?: number;
  /** Поворот усієї дуги, градуси. 0 — строго вгору. */
  bias?: number;
  label?: string;
  className?: string;
}

/** Мертва зона: коротший рух — це ще клік, а не жест вибору. */
const TAP_RADIUS = 14;

export function RadialMenu({
  items,
  stagger = 28,
  radius = 68,
  spread = 150,
  bias = 0,
  label = 'Додати',
  className,
}: RadialMenuProps) {
  const [open, setOpen] = useState(false);
  const [aim, setAim] = useState<number | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const moved = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const n = items.length;

  /** Кут пункта в тій самій системі, що й у CSS. */
  const angleOf = useCallback(
    (i: number) => {
      const step = n > 1 ? spread / (n - 1) : 0;
      return ((bias - 90 - spread / 2 + step * i) * Math.PI) / 180;
    },
    [bias, n, spread],
  );

  /** Найближчий пункт за напрямком руху. */
  const nearestByAngle = useCallback(
    (dx: number, dy: number) => {
      const target = Math.atan2(dy, dx);
      let best = 0;
      let bestDiff = Infinity;
      for (let i = 0; i < n; i += 1) {
        // Різниця кутів по колу: без нормалізації −170° і 170° виглядали б
        // як протилежні, хоча між ними 20°.
        const diff = Math.abs(Math.atan2(Math.sin(target - angleOf(i)), Math.cos(target - angleOf(i))));
        if (diff < bestDiff) {
          bestDiff = diff;
          best = i;
        }
      }
      return best;
    },
    [angleOf, n],
  );

  const close = useCallback(() => {
    setOpen(false);
    setAim(null);
  }, []);

  // Клік повз меню закриває його. Слухач ставимо лише поки воно відкрите.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    origin.current = { x: event.clientX, y: event.clientY };
    moved.current = false;
    setAim(null);
    setOpen(true);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!open) return;
    const dx = event.clientX - origin.current.x;
    const dy = event.clientY - origin.current.y;
    if (Math.hypot(dx, dy) < TAP_RADIUS) {
      setAim(null);
      return;
    }
    moved.current = true;
    setAim(nearestByAngle(dx, dy));
  };

  const onPointerUp = () => {
    // Рух був і ціль є — це жест: виконуємо й закриваємо.
    // Руху не було — це звичайний клік, меню лишається відкритим.
    if (moved.current && aim !== null) {
      items[aim]?.onSelect();
      close();
      return;
    }
    if (moved.current) close();
  };

  return (
    <div
      ref={rootRef}
      className={'fan' + (className ? ' ' + className : '')}
      data-open={open ? '' : undefined}
      style={
        {
          '--spread': `${spread}deg`,
          '--radius': `${radius}px`,
          '--bias': `${bias}deg`,
          '--stagger': `${stagger}ms`,
          '--n': n,
        } as CSSProperties
      }
    >
      <div className="fan-arc" data-open={open ? '' : undefined}>
        {items.map((item, i) => (
          <button
            key={item.key}
            type="button"
            className="fan-opt"
            style={{ '--i': i } as CSSProperties}
            data-aim={aim === i ? '' : undefined}
            aria-label={item.label}
            tabIndex={open ? 0 : -1}
            onClick={() => {
              item.onSelect();
              close();
            }}
          >
            {item.icon}
            <span className="fan-tip">{item.label}</span>
          </button>
        ))}
      </div>

      <button
        type="button"
        className="fan-core"
        aria-label={label}
        aria-expanded={open}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={close}
        onClick={(event) => {
          // Клік уже опрацьовано в pointerdown/up; тут лише глушимо повторне
          // спрацювання, інакше меню відкривалось і одразу закривалось.
          event.preventDefault();
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none"
             stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    </div>
  );
}
