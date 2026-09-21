import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Dock } from '@/vendor/reactbits';
import { SECTIONS } from '@/app/sections';
import { useIsPhone } from '@/hooks/useMediaQuery';
import { nearestSide, useDockSide, type DockSide } from '@/hooks/useDockSide';
import { cn } from '@/lib/cn';

/*
 * Навігація — док (React Bits · Dock).
 *
 * Замінює і бічну рейку столу, і нижню панель телефона: одна навігація на
 * всі ширини. Док плаває над вмістом, тож розділи лишають під ним місце —
 * з того боку, де він зараз стоїть (див. `data-dock` на <html>).
 *
 * ЗВЕРХУ док живе В САМІЙ ШАПЦІ, а не окремою смугою під нею. Шапка й так
 * тягнеться на всю ширину, а посередині в неї порожньо; друга смуга поруч
 * з'їдала ще 84 px висоти й виглядала як випадково злиплі дві панелі.
 * Технічно це портал у слот шапки: логіка перенесення лишається одна на всі
 * чотири боки, змінюється лише те, КУДИ док віддається.
 *
 * ПЕРЕНЕСЕННЯ. Затиснути док і повести — він прилипне до найближчого краю.
 * Це не прикраса: нижній край забирає найдорожче місце на широкому екрані
 * (там закінчується текст), а на телефоні в одній руці зручний саме низ.
 * Поки тягнемо, кліки по розділах глушаться — інакше перенесення завжди
 * закінчувалось би переходом у той розділ, за який узялись.
 */

/** Скільки треба провести, щоб це рахувалось перенесенням, а не кліком. */
const DRAG_START = 10;

export function DockNav({
  current,
  onNavigate,
}: {
  current: string;
  onNavigate: (id: string) => void;
}) {
  const isPhone = useIsPhone();
  const [side, setSide] = useDockSide();
  // Куди прилипне, якщо відпустити зараз. null — перенесення не почалось.
  const [aim, setAim] = useState<DockSide | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const dragging = useRef(false);

  const vertical = side === 'left' || side === 'right';
  const inTopbar = side === 'top';

  /*
   * Вузол шапки, у який віддаємо док. Шукаємо в ефекті, а не одразу: шапка
   * і док — сусіди в дереві, і на першому проході слота ще немає.
   */
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setSlot(inTopbar ? document.getElementById('dock-slot') : null);
  }, [inTopbar]);

  /*
   * Перенесення слухаємо на ВІКНІ, а не на самому доці.
   *
   * Поки тягнуть, курсор іде геть від дока — до протилежного краю екрана. З
   * подіями на елементі відпускання приходило вже над іншим елементом, і
   * док лишався на місці: підсвітка краю показувалась, а переїзд не
   * відбувався. Захоплення вказівника тут не рятує: воно може не
   * встановитись, і тоді жест мовчки ламається.
   */
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // Touch layouts keep the dock anchored to the bottom. Repositioning it
    // from a one-handed tap is surprising and competes with horizontal swipes
    // used by the app shell, so relocation remains a desktop gesture.
    if (event.button !== 0 || isPhone || event.pointerType === 'touch') return;
    origin.current = { x: event.clientX, y: event.clientY };
    dragging.current = false;

    const move = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - origin.current.x;
      const dy = moveEvent.clientY - origin.current.y;
      if (!dragging.current && Math.hypot(dx, dy) < DRAG_START) return;
      dragging.current = true;
      setAim(nearestSide(moveEvent.clientX, moveEvent.clientY));
    };

    const up = (upEvent: PointerEvent) => {
      document.body.style.userSelect = '';
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (dragging.current) {
        setSide(nearestSide(upEvent.clientX, upEvent.clientY));
        // Клік по розділу прилетить наступним — глушимо його один раз,
        // інакше перенесення завжди закінчувалось би переходом у той
        // розділ, за значок якого взялись.
        window.addEventListener('click', (click) => {
          click.preventDefault();
          click.stopPropagation();
        }, { capture: true, once: true });
      }
      dragging.current = false;
      setAim(null);
    };

    // Поки тягнемо — не виділяємо текст. Інакше протяг через півекрана
    // лишав по собі підсвічену половину сторінки.
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const dock = (
    <div
      className={cn(
        'pointer-events-auto select-none',
        isPhone ? 'touch-pan-x' : 'touch-none',
        aim ? 'cursor-grabbing' : 'cursor-grab',
      )}
      onPointerDown={onPointerDown}
    >
      <Dock
        axis={vertical ? 'y' : 'x'}
        className={inTopbar ? 'dock-inline' : ''}
        items={SECTIONS.map((section) => {
          const Icon = section.icon;
          return {
            icon: (
              <Icon
                size={inTopbar ? 17 : isPhone ? 17 : 19}
                strokeWidth={section.id === current ? 2.1 : 1.75}
              />
            ),
            label: section.label,
            onClick: () => onNavigate(section.id),
            // Активний розділ підсвічує наш CSS (styles/vendor.css):
            // сам компонент про поточний стан нічого не знає.
            className: section.id === current ? 'dock-item-active' : '',
          };
        })}
        // У шапці все менше: смуга 56 px, і значок мусить у неї влазити
        // разом зі збільшенням. На телефоні збільшення не спрацьовує
        // (курсора нема), тож там усе просто менше й рівне.
        baseItemSize={inTopbar ? 32 : isPhone ? 44 : vertical ? 44 : 38}
        magnification={inTopbar ? 42 : isPhone ? 44 : 58}
        distance={inTopbar ? 110 : 150}
        panelHeight={inTopbar ? 42 : 52}
        dockHeight={inTopbar ? 42 : 140}
      />
    </div>
  );

  return (
    <>
      {/* Підказка, куди стане док. Показуємо лише поки тягнуть. */}
      {aim ? (
        <div
          aria-hidden="true"
          className={cn(
            'pointer-events-none fixed bg-accent/25 transition-all duration-150',
            aim === 'bottom' && 'inset-x-0 bottom-0 h-20',
            aim === 'top' && 'inset-x-0 top-0 h-20',
            aim === 'left' && 'inset-y-0 left-0 w-20',
            aim === 'right' && 'inset-y-0 right-0 w-20',
          )}
          style={{ zIndex: 'var(--z-rail)' }}
        />
      ) : null}

      {inTopbar ? (
        slot ? createPortal(dock, slot) : null
      ) : (
        <div
          className={cn(
            'u-safe-b pointer-events-none fixed flex',
            side === 'bottom' && 'inset-x-0 bottom-0 justify-center',
            // Знизу від шапки: вона лежить вище за z-index, і верхній значок
            // вертикального дока інакше ховається під нею.
            side === 'left' && 'bottom-0 left-0 top-14 items-center',
            side === 'right' && 'bottom-0 right-0 top-14 items-center',
          )}
          style={{ zIndex: 'var(--z-rail)' }}
          data-dock={side}
        >
          {dock}
        </div>
      )}
    </>
  );
}
