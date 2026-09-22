import { useCallback, useEffect, useRef, useState } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { AnimatePresence, motion } from 'motion/react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Link2,
  Minus,
  Plus,
  Share2,
  X,
} from 'lucide-react';
import { LatticeLoader } from '@/vendor/reactbits';
import { Morph } from '@/components/ui/Morph';
import { Tip } from '@/components/ui/Tip';
import { useToast } from '@/components/ui/Toaster';
import { cn } from '@/lib/cn';
import { t } from '@/locales/chat';

/*
 * Переглядач картинок.
 *
 * У стрічці всі картинки однакового розміру — інакше відповідь із трьома
 * фото розсипає розмову на три різні сторінки. Повний розмір живе тут: одне
 * вікно на весь екран, де картинку видно цілою, можна наблизити, зберегти
 * собі або кинути посиланням, і перейти до наступної, не закриваючи вікна.
 *
 * Модалка радіксова заради дрібниць, які самому робити довго й марно:
 * перехоплення фокуса, Esc, повернення фокуса на картинку після закриття.
 */

export interface GalleryImage {
  src: string;
  alt: string;
}

/** Кроки масштабу. Не плавний зум: кнопками потрібні передбачувані щаблі. */
const ZOOM = [1, 1.5, 2, 3, 4];

/** Адреса для збереження — через бота, інакше чужий хост не дасть. */
function downloadHref(image: GalleryImage): string {
  const name = image.alt?.trim() || t('image.fallback');
  return `/api/image/fetch?url=${encodeURIComponent(image.src)}&name=${encodeURIComponent(name)}`;
}

export function ImageViewer({
  images,
  initialIndex,
  onClose,
}: {
  images: GalleryImage[];
  initialIndex: number;
  onClose: () => void;
}) {
  const { toast, error } = useToast();
  const [index, setIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const swipeRef = useRef<{ id: number; x: number; y: number } | null>(null);

  const image = images[index];
  const scale = ZOOM[zoom];
  const many = images.length > 1;

  // Нова картинка — завжди з початкового масштабу й з початку кадру:
  // інакше після зуму наступна відкривається «в середині» випадкового місця.
  const go = useCallback(
    (step: number) => {
      setIndex((current) => (current + step + images.length) % images.length);
      setZoom(0);
      setLoaded(false);
      scrollRef.current?.scrollTo({ top: 0, left: 0 });
    },
    [images.length],
  );

  // Після наближення лишаємось у центрі кадру. Без цього прокрутка
  // тримається нуля, і «наблизити» показує верхній лівий кут — тобто не те
  // місце, на яке людина щойно дивилась.
  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    box.scrollTo({
      left: (box.scrollWidth - box.clientWidth) / 2,
      top: (box.scrollHeight - box.clientHeight) / 2,
    });
  }, [zoom]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight' && many) go(1);
      else if (event.key === 'ArrowLeft' && many) go(-1);
      else if (event.key === '+' || event.key === '=') setZoom((z) => Math.min(z + 1, ZOOM.length - 1));
      else if (event.key === '-') setZoom((z) => Math.max(z - 1, 0));
      else if (event.key === '0') setZoom(0);
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, many]);

  const copyLink = () => {
    void navigator.clipboard.writeText(image.src).then(
      () => toast(t('image.linkCopied')),
      () => error(t('image.copyFailed')),
    );
  };

  /*
   * «Поділитись» — системне вікно там, де воно є (телефон, Safari), і тихе
   * копіювання там, де немає. Окремого списку месенджерів не будуємо: у
   * панелі, яка живе на одній машині, він був би вітриною без адресатів.
   */
  const share = () => {
    if (typeof navigator.share !== 'function') {
      copyLink();
      return;
    }
    void navigator
      .share({ title: image.alt || t('image.fallbackCap'), url: image.src })
      .catch(() => undefined);
  };

  const download = () => {
    const link = document.createElement('a');
    link.href = downloadHref(image);
    link.download = image.alt?.trim() || t('image.fallback');
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  return (
    <RadixDialog.Root open onOpenChange={(open) => !open && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay asChild>
          <motion.div
            className="fixed inset-0 backdrop-blur-[3px]"
            style={{ background: 'var(--c-overlay)', zIndex: 'var(--z-modal)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          />
        </RadixDialog.Overlay>

        <RadixDialog.Content
          aria-describedby={undefined}
          style={{ zIndex: 'var(--z-modal)' }}
          className="fixed inset-0 flex flex-col outline-none"
        >
          <RadixDialog.Title className="sr-only">
            {image.alt || t('image.fallbackCap')}
          </RadixDialog.Title>

          {/* Клік по порожньому полю закриває — звичний жест для такого вікна. */}
          <div
            ref={scrollRef}
            data-swipe-ignore
            onPointerDown={(event) => {
              if (!many || zoom > 0 || event.pointerType !== 'touch' || !event.isPrimary) return;
              swipeRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
            }}
            onPointerUp={(event) => {
              const start = swipeRef.current;
              swipeRef.current = null;
              if (!start || start.id !== event.pointerId || zoom > 0) return;
              const dx = event.clientX - start.x;
              const dy = event.clientY - start.y;
              if (Math.abs(dx) >= 48 && Math.abs(dx) > Math.abs(dy) * 1.2) go(dx < 0 ? 1 : -1);
            }}
            onPointerCancel={() => { swipeRef.current = null; }}
            onClick={(event) => {
              if (event.target === event.currentTarget) onClose();
            }}
            /*
             * Grid, а не flex із центруванням: коли наближену картинку треба
             * прокрутити, `justify-content: center` не дає доїхати до лівого
             * краю — початок вмісту опиняється в від'ємних координатах.
             * Центрування через `m-auto` на самій картинці такої вади не має.
             *
             * Знизу лишаємо місце під панель: інакше при повній висоті вікна
             * картинка лягала б рівно під підпис.
             */
            className={cn(
              'grid min-h-0 flex-1 px-4 pb-28 pt-4 sm:px-10 sm:pb-32 sm:pt-10',
              scale > 1 ? 'overflow-auto' : 'overflow-hidden',
            )}
          >
            <AnimatePresence mode="wait">
              <motion.div
                key={image.src}
                className="relative m-auto flex items-center justify-center"
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.99 }}
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              >
                {!loaded ? (
                  <div className="absolute inset-0 grid place-items-center">
                    <LatticeLoader
                      status="working"
                      label={t('image.loading')}
                      cellSize={7}
                      gap={3}
                      color="var(--c-accent)"
                      showTimer={false}
                    />
                  </div>
                ) : null}
                <img
                  src={image.src}
                  alt={image.alt}
                  onLoad={() => setLoaded(true)}
                  onError={() => setLoaded(true)}
                  draggable={false}
                  /*
                   * Наближення через `zoom`, а не `transform: scale`.
                   *
                   * transform розтягує лише намальоване: місця елемент
                   * займає стільки ж, тож наближена картинка вилазить за
                   * кадр і прокрутити її нікуди. `zoom` множить саму
                   * розкладку — контейнер отримує що прокручувати, і
                   * збільшення працює навіть за межі власного розміру
                   * картинки, як і чекають від лупи.
                   */
                  style={{ zoom: scale }}
                  className={cn(
                    'max-h-[calc(100dvh-12rem)] max-w-[min(1200px,92vw)]',
                    'rounded-md object-contain shadow-pop',
                    loaded ? 'opacity-100' : 'opacity-0',
                  )}
                />
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Стрілки — по краях екрана, а не в панелі: гортати хочеться там,
              де курсор уже є, а не цілитись у дрібну кнопку внизу. */}
          {many ? (
            <>
              <Edge side="left" onClick={() => go(-1)} />
              <Edge side="right" onClick={() => go(1)} />
            </>
          ) : null}

          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.06, type: 'spring', stiffness: 460, damping: 34 }}
            className="u-safe-b pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-2 p-4"
          >
            {image.alt ? (
              <p className="pointer-events-auto max-w-[min(680px,90vw)] truncate rounded-full bg-surface/90 px-3 py-1 text-center text-[13px] text-ink backdrop-blur">
                {image.alt}
              </p>
            ) : null}

            <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-line bg-surface/95 p-1 shadow-pop backdrop-blur">
              <Action
                tip={t('image.zoomOut')}
                shortcut="−"
                onClick={() => setZoom((z) => Math.max(z - 1, 0))}
                disabled={zoom === 0}
              >
                <Minus />
              </Action>
              {/* Відсоток морфиться на місці (Torph): цифри міняються, а
                  ширина панелі — ні, тож кнопки не стрибають. */}
              <button
                type="button"
                onClick={() => setZoom(0)}
                className="min-w-[3.4rem] rounded-full px-1 text-center font-mono text-[12px] text-ink-2 transition-colors hover:text-ink"
                aria-label={t('image.zoomReset')}
              >
                <Morph mono>{`${Math.round(scale * 100)}%`}</Morph>
              </button>
              <Action
                tip={t('image.zoomIn')}
                shortcut="+"
                onClick={() => setZoom((z) => Math.min(z + 1, ZOOM.length - 1))}
                disabled={zoom === ZOOM.length - 1}
              >
                <Plus />
              </Action>

              <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />

              <Action tip={t('image.share')} onClick={share}>
                <Share2 />
              </Action>
              <Action tip={t('image.copyLink')} onClick={copyLink}>
                <Link2 />
              </Action>
              <Action tip={t('image.download')} onClick={download}>
                <Download />
              </Action>

              {many ? (
                <>
                  <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
                  <span className="px-1 font-mono text-[12px] text-ink-3">
                    <Morph mono>{`${index + 1}/${images.length}`}</Morph>
                  </span>
                  <Action tip={t('image.next')} shortcut="→" onClick={() => go(1)}>
                    <ChevronRight />
                  </Action>
                </>
              ) : null}
            </div>
          </motion.div>

          <RadixDialog.Close asChild>
            <button
              type="button"
              aria-label={t('chat.close')}
              className="absolute right-4 top-4 grid size-11 place-items-center rounded-full border border-line bg-surface/95 text-ink-2 shadow-raise backdrop-blur transition-colors hover:text-ink sm:size-9"
            >
              <X className="size-4" />
            </button>
          </RadixDialog.Close>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/** Кнопка панелі: іконка + підказка словом. */
function Action({
  tip,
  shortcut,
  onClick,
  disabled,
  children,
}: {
  tip: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tip content={tip} shortcut={shortcut}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={tip}
        className="grid size-11 place-items-center rounded-full text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink disabled:pointer-events-none disabled:opacity-35 sm:size-8 [&_svg]:size-4"
      >
        {children}
      </button>
    </Tip>
  );
}

/** Половина екрана як зона гортання — із стрілкою, що проявляється. */
function Edge({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === 'left' ? t('image.prev') : t('image.next')}
      className={cn(
        'group absolute inset-y-0 w-[18%] max-w-[140px] outline-none',
        side === 'left' ? 'left-0' : 'right-0',
      )}
    >
      <span
        className={cn(
          'absolute top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full',
          'border border-line bg-surface/95 text-ink-2 shadow-raise backdrop-blur',
          'opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100',
          side === 'left' ? 'left-4' : 'right-4',
        )}
      >
        {side === 'left' ? <ChevronLeft className="size-5" /> : <ChevronRight className="size-5" />}
      </span>
    </button>
  );
}
