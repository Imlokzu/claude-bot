import { MetalText, isMetalFxSupported } from 'metal-fx';
import { ShinyText } from '@/vendor/reactbits';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/lib/cn';

/*
 * Знак панелі. Блокові символи ▞▚ — те саме, що стояло в шапці старої панелі
 * й на екрані вхідного гейта. Це єдиний градієнт, дозволений у DESIGN.md.
 *
 * Сама назва залита рідким металом (metal-fx). Це ЄДИНЕ місце в панелі, де
 * такий ефект доречний: логотип на те й логотип, що його розглядають, а не
 * читають. Де WebGL недоступний — лишається ShinyText, той самий напис без
 * шейдера, а не порожнє місце.
 */
export function Brand({ compact, className }: { compact?: boolean; className?: string }) {
  const { resolved } = useTheme();

  return (
    <div className={cn('flex select-none items-baseline gap-2', className)}>
      <span
        aria-hidden="true"
        className="font-mono text-[15px] leading-none"
        style={{
          backgroundImage: 'linear-gradient(135deg, var(--c-accent), color-mix(in oklab, var(--c-accent) 55%, var(--c-text)))',
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          color: 'transparent',
        }}
      >
        ▞▚
      </span>
      {isMetalFxSupported() ? (
        <MetalText
          font="500 13px/1 'IBM Plex Mono Variable', ui-monospace, monospace"
          color="var(--c-text)"
          theme={resolved}
          strength={0.55}
          className="tracking-[0.14em]"
        >
          КЛОД БОТ
        </MetalText>
      ) : (
        <ShinyText
          text="КЛОД БОТ"
          speed={7}
          spread={90}
          color="var(--c-text)"
          shineColor="var(--c-accent)"
          className="font-mono text-[13px] font-medium tracking-[0.14em]"
        />
      )}
      {!compact ? (
        <span className="font-mono text-[11px] tracking-[0.14em] text-ink-3">· ВІРТУАЛЬНИЙ</span>
      ) : null}
    </div>
  );
}
