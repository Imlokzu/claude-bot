import { cn } from '@/lib/cn';

/*
 * One setting, the way a preferences window is read: the name and the
 * reason on the left, the control on the right. Cards group rows that
 * belong together. Depth stays a 1px line, not a shadow.
 */

export function SettingGroup({
  label,
  children,
}: {
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      {label ? <h2 className="mb-2 px-1 text-[13px] font-medium text-ink-2">{label}</h2> : null}
      <div className="overflow-hidden rounded-lg border border-line bg-surface">{children}</div>
    </section>
  );
}

export function SettingRow({
  label,
  hint,
  htmlFor,
  children,
  className,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-start gap-3 border-b border-line px-4 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6', className)}>
      <div className="min-w-0">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="block text-[13px] text-ink">{label}</label>
        ) : (
          <p className="text-[13px] text-ink">{label}</p>
        )}
        {hint ? <p className="mt-0.5 text-[12px] leading-snug text-ink-3">{hint}</p> : null}
      </div>
      <div className="flex shrink-0 items-center">{children}</div>
    </div>
  );
}
