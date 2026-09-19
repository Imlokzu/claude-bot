import { cn } from '@/lib/cn';

/*
 * Панель — базова поверхня. Глибина будується межею й тоном, не тінню
 * (DESIGN.md, правило 1).
 */

export function Panel({
  className,
  flush,
  ...props
}: React.HTMLAttributes<HTMLElement> & { flush?: boolean }) {
  return (
    <section
      className={cn(
        'flex min-h-0 min-w-0 flex-col rounded-lg border border-line bg-surface',
        !flush && 'p-4 sm:p-5',
        className,
      )}
      {...props}
    />
  );
}

/**
 * Шапка секції. Мітка моноширинними капітеллю — фірмовий прийом панелі;
 * саме вона робить її «приладом», тож окремого заголовка H2 тут не треба.
 */
export function PanelHead({
  label,
  hint,
  actions,
  className,
}: {
  label: string;
  hint?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('mb-3 flex min-h-8 items-center justify-between gap-3', className)}>
      <div className="flex min-w-0 items-baseline gap-2.5">
        <h2 className="u-label">{label}</h2>
        {hint ? <span className="truncate text-[12px] text-ink-3">{hint}</span> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </header>
  );
}
