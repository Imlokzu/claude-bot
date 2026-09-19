import { useEffect, useRef, useState } from 'react';
import PixelCrab from '@/vendor/pixelcrab/crab.js';
import { ElectricBorder, PixelCard, SplitFlapText } from '@/vendor/reactbits';
import { useBotEvents } from '@/hooks/useBotEvents';
import { useTheme } from '@/hooks/useTheme';
import { useAccentColor, useCssVar } from '@/hooks/useAccentRgb';
import { useMediaQuery } from '@/hooks/useMediaQuery';

/*
 * Головна плитка «Огляду»: краб і те, що він зараз робить.
 *
 * Три шари, кожен зі своїм завданням:
 *   PixelCard      — піксельне тло, що прокидається під курсором; рима до
 *                    самого краба, а не просто ефект;
 *   ElectricBorder — рамка, що живе ЛИШЕ поки бот думає чи говорить. Це не
 *                    оздоблення: саме вона відповідає на питання «він завис
 *                    чи працює», яке в старій панелі вимагало лізти в логи;
 *   SplitFlapText  — стан словом, перекидними табло. Приладовість, і зміна
 *                    стану видно периферійним зором через пів кімнати.
 */

const STATE_WORDS: Record<string, string> = {
  idle: 'ЧЕКАЮ',
  listening: 'СЛУХАЮ',
  thinking: 'ДУМАЮ',
  speaking: 'КАЖУ',
  happy: 'РАДИЙ',
  sad: 'СУМНО',
  confused: 'НЕ ЗРОЗУМІВ',
  surprised: 'ОТАКОЇ',
  love: 'ЛЮБЛЮ',
  sleepy: 'ДРІМАЮ',
  searching: 'ШУКАЮ',
  web: 'У МЕРЕЖІ',
  working: 'ПРАЦЮЮ',
  writing: 'ПИШУ',
};

/** Стани, у яких бот СПРАВДІ зайнятий — лише вони світять рамкою. */
const BUSY = new Set(['thinking', 'speaking', 'searching', 'web', 'working', 'writing', 'listening']);

interface CrabInstance {
  setEmotion: (emotion: string) => void;
  destroy: () => void;
}

export function BotState() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const crabRef = useRef<CrabInstance | null>(null);
  const { resolved, accent } = useTheme();
  const accentColor = useAccentColor();
  // PixelCard теж canvas: сюди йдуть лише обчислені кольори.
  const faint = useCssVar('--c-text-3', '#958979');
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [emotion, setEmotion] = useState('idle');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const body = getComputedStyle(document.documentElement).getPropertyValue('--c-accent').trim();
    const crab = new PixelCrab(canvas, null, null, {
      bodyColor: body || '#d98263',
      shadowColor: `color-mix(in oklab, ${body} 78%, #000)`,
      eyeColor: resolved === 'dark' ? '#0d0b0a' : '#141414',
    }) as unknown as CrabInstance;
    crabRef.current = crab;
    return () => {
      crab.destroy();
      crabRef.current = null;
    };
  }, [resolved, accent]);

  useBotEvents((event) => {
    if (event.type === 'emotion' && typeof event.emotion === 'string') {
      setEmotion(event.emotion);
      crabRef.current?.setEmotion(event.emotion);
    }
  });

  const busy = BUSY.has(emotion);
  const word = STATE_WORDS[emotion] ?? 'ЧЕКАЮ';

  const card = (
    <PixelCard
      variant="default"
      colors={`${accentColor},${faint},${accentColor}`}
      className="size-full"
      noFocus
    >
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4">
        <canvas
          ref={canvasRef}
          width={256}
          height={150}
          className="h-auto w-full max-w-[210px] [image-rendering:pixelated]"
        />
        <SplitFlapText
          text={word}
          loop={false}
          fontSize={17}
          gap={4}
          tileRadius={4}
          padTo={word.length}
          tileColor="var(--c-surface-3)"
          textColor="var(--c-text)"
        />
      </div>
    </PixelCard>
  );

  return (
    <div className="relative size-full">
      {busy && !reduced ? (
        <ElectricBorder
          color={accentColor}
          speed={1.1}
          chaos={0.35}
          borderRadius={11}
          className="size-full"
        >
          {card}
        </ElectricBorder>
      ) : (
        card
      )}
    </div>
  );
}
