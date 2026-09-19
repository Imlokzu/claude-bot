import { cn } from '@/lib/cn';

/* Порожньо, вантажиться, зламалось — три стани, які має мати кожен список. */

export function Empty({
  icon: Icon,
  title,
  hint,
  action,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center',
        className,
      )}
    >
      {Icon ? <Icon className="size-7 text-ink-3" /> : null}
      <div className="space-y-1">
        <p className="text-sm text-ink-2">{title}</p>
        {hint ? <p className="u-measure text-[13px] text-ink-3">{hint}</p> : null}
      </div>
      {action}
    </div>
  );
}

/**
 * Скелетон замість спінера: користувач бачить, ЩО саме зараз приїде, і не
 * ловить стрибок розкладки в момент появи даних (DESIGN.md, «Заборонено»).
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('animate-pulse rounded-sm bg-surface-3', className)}
      aria-hidden="true"
    />
  );
}

export function SkeletonList({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton
          key={index}
          className="h-9"
          // Різна ширина рядків — інакше скелетон читається як таблиця, а не
          // як текст, що вантажиться.
        />
      ))}
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-md border border-err/35 bg-err/8 p-3">
      <p className="text-[13px] text-ink">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="text-[13px] font-medium text-accent hover:underline"
        >
          Спробувати ще раз
        </button>
      ) : null}
    </div>
  );
}
