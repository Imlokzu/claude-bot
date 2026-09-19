import { SquishSwitch } from '@/vendor/reactbits';
import { cn } from '@/lib/cn';

/*
 * Перемикач — React Bits · SquishSwitch, підв'язаний до наших токенів.
 * Кольори йдуть пропсами, бо компонент пише їх інлайн-стилем і таблиця
 * стилів його не перекриє (див. src/styles/vendor.css).
 */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
  id,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}) {
  return (
    <SquishSwitch
      id={id}
      checked={checked}
      onChange={onChange}
      disabled={disabled}
      ariaLabel={label}
      className={className}
      width={52}
      height={30}
      radius={15}
      trackColor="var(--c-surface-3)"
      trackOnColor="var(--c-accent)"
      thumbColor="var(--c-surface)"
      thumbOnColor="var(--c-accent-ink)"
    />
  );
}

/** Перемикач із підписом і поясненням — рядок налаштувань. */
export function SwitchRow({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center justify-between gap-4 rounded-md px-1 py-2.5',
        'transition-colors hover:bg-surface-2',
        disabled && 'pointer-events-none opacity-50',
      )}
    >
      <span className="min-w-0">
        <span className="block text-sm text-ink">{label}</span>
        {hint ? <span className="mt-0.5 block text-[12px] text-ink-3">{hint}</span> : null}
      </span>
      <Switch checked={checked} onChange={onChange} disabled={disabled} label={label} />
    </label>
  );
}
