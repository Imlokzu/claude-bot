import { RubberSegment } from '@/vendor/reactbits';

/*
 * Сегментований перемикач — React Bits · RubberSegment. Бере на себе те, що
 * в старій панелі робив m3-segmented: довжина відповіді, режим мозку,
 * вибір теми.
 */
export function Segmented<T extends string>({
  items,
  value,
  onChange,
  size = 'md',
  disabled,
  ariaLabel,
  className,
}: {
  items: { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <RubberSegment
      items={items.map((item) => ({ value: item.value, label: item.label }))}
      value={value}
      // Вендор типізує значення як string; звужуємо назад до T — список
      // варіантів задаємо ми, тож інших значень звідти не приходить.
      onChange={(next) => onChange(next as T)}
      size={size}
      disabled={disabled}
      aria-label={ariaLabel}
      className={className}
      radius={9}
      trackColor="var(--c-surface-2)"
      thumbColor="var(--c-surface)"
      textColor="var(--c-text-2)"
      activeTextColor="var(--c-text)"
    />
  );
}
