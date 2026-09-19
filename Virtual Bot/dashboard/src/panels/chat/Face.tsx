import { useEffect, useRef, useState } from 'react';
import PixelCrab from '@/vendor/pixelcrab/crab.js';
import { useBotEvents } from '@/hooks/useBotEvents';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/lib/cn';

/*
 * Обличчя бота — піксельний краб.
 *
 * Клас приїхав зі старої панелі (static/crab.js, порт з PixelClaw) і лишився
 * майже незмінним: додано лише destroy(), бо там він жив на сторінці вічно,
 * а тут розділ монтується й розмонтовується.
 *
 * Колір тіла береться з акценту теми: краб і панель мають бути однієї крові
 * (DESIGN.md). Для теракоти це майже його рідний відтінок, для решти —
 * приглушений варіант акценту, щоб він лишався крабом, а не плямою.
 */

interface CrabInstance {
  setEmotion: (emotion: string) => void;
  setAudioLevel: (level: number | null) => void;
  showDefeat: (ms?: number, after?: string) => void;
  destroy: () => void;
  emotion: string;
}

function readVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function Face({ className, compact }: { className?: string; compact?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const crabRef = useRef<CrabInstance | null>(null);
  const { resolved, accent } = useTheme();
  const [emotion, setEmotion] = useState('idle');

  // Перестворюємо краба при зміні теми: палітра задається в конструкторі,
  // і міняти її на льоту клас не вміє. Перемикання теми — рідкісна подія,
  // тож перезапуск дешевший за додавання сеттера у вендорний код.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const body = readVar('--c-accent') || '#d98263';
    const crab = new PixelCrab(canvas, labelRef.current, null, {
      bodyColor: body,
      shadowColor: `color-mix(in oklab, ${body} 78%, #000)`,
      eyeColor: resolved === 'dark' ? '#0d0b0a' : '#141414',
      heartColor: readVar('--c-err') || '#ff9ac1',
      zColor: readVar('--c-info') || '#7dcfff',
    }) as unknown as CrabInstance;

    crabRef.current = crab;
    crab.setEmotion(emotion);
    return () => {
      crab.destroy();
      crabRef.current = null;
    };
    // emotion навмисно поза залежностями: його передає ефект нижче, а тут
    // він лише відновлює поточний стан після перестворення.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved, accent]);

  // Емоція приходить зі стрічки подій — її шле і чат, і зір, і дрімота.
  useBotEvents((event) => {
    if (event.type === 'emotion' && typeof event.emotion === 'string') {
      setEmotion(event.emotion);
      crabRef.current?.setEmotion(event.emotion);
    }
  });

  return (
    <div
      className={cn(
        'relative flex flex-col items-center justify-center overflow-hidden rounded-md border border-line bg-surface-2',
        compact ? 'h-14 w-24' : 'h-auto py-1',
        className,
      )}
      data-emotion={emotion}
    >
      <canvas
        ref={canvasRef}
        width={256}
        height={compact ? 90 : 150}
        className="h-auto w-full max-w-[220px] [image-rendering:pixelated]"
      />
      {/* Підпис емоції — під полотном, не поверх: абсолютним він накладався
          на ніжки краба, і в темній темі це читалось як артефакт. */}
      {!compact ? <div ref={labelRef} className="u-label pb-2 pt-1 text-[10px]" /> : null}
    </div>
  );
}
