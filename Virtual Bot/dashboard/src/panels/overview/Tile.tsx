import { useEffect, useState } from 'react';
import { CountUp, ParticleCard } from '@/vendor/reactbits';
import { useAccentRgb } from '@/hooks/useAccentRgb';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';

/*
 * Плитка «Огляду».
 *
 * Механіка — з MagicBento (React Bits): частинки, нахил за курсором,
 * магнетизм і спільний прожектор по сітці. Розмітка своя: демо MagicBento
 * має зашиті картки, тож ми взяли з нього рівно те, що варте перевикористання
 * (див. правку в MagicBento.jsx).
 *
 * На дотику вся ця механіка вимикається: вона будується на русі курсора,
 * якого там немає, а таймери частинок усе одно крутились би.
 */
export function Tile({
  span = 'sm',
  interactive = true,
  className,
  children,
}: {
  /** Розмір у сітці: sm 1×1, md 2×1, lg 2×2, wide на всю ширину. */
  span?: 'sm' | 'md' | 'lg' | 'wide';
  interactive?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const glow = useAccentRgb();
  const fine = useMediaQuery('(hover: hover) and (pointer: fine)');
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const off = !interactive || !fine || reduced;

  const SPAN: Record<string, string> = {
    sm: 'col-span-2 row-span-1 sm:col-span-1',
    md: 'col-span-2 row-span-1',
    lg: 'col-span-2 row-span-2',
    wide: 'col-span-2 row-span-1 lg:col-span-4',
  };

  return (
    <ParticleCard
      className={cn(
        'bento-tile group relative flex min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-surface p-4',
        SPAN[span],
        className,
      )}
      disableAnimations={off}
      glowColor={glow}
      particleCount={8}
      enableTilt={false}
      enableMagnetism
      clickEffect
    >
      {children}
    </ParticleCard>
  );
}

/** Шапка плитки: моноширинна мітка + необовʼязкова дія праворуч. */
export function TileHead({
  label,
  action,
}: {
  label: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <span className="u-label">{label}</span>
      {action}
    </div>
  );
}

/**
 * Велике число плитки — CountUp з React Bits.
 *
 * Рахунок запускається лише коли значення вперше приїхало: інакше кожне
 * фонове оновлення запиту перезапускало б відлік і сітка блимала б числами.
 */
export function TileNumber({ value, suffix }: { value: number | null; suffix?: string }) {
  const [start, setStart] = useState<number | null>(null);
  useEffect(() => {
    if (value !== null && start === null) setStart(value);
  }, [value, start]);

  return (
    <div className="mt-auto flex items-baseline gap-1.5">
      {value === null ? (
        <span className="u-data text-[30px] font-medium leading-none text-ink-3">—</span>
      ) : start === null ? (
        <span className="u-data text-[30px] font-medium leading-none text-ink">{value}</span>
      ) : (
        <CountUp
          to={value}
          duration={1.1}
          className="u-data text-[30px] font-medium leading-none tracking-[-0.03em] text-ink"
        />
      )}
      {suffix ? <span className="text-[12px] text-ink-3">{suffix}</span> : null}
    </div>
  );
}
