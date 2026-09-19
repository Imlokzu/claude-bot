import { forwardRef } from 'react';
import { cn } from '@/lib/cn';

/* Поля вводу. Одна геометрія на всі типи — інакше форма розсипається. */

const base = [
  'w-full rounded-md border border-line bg-surface-2 px-3 text-sm text-ink',
  'placeholder:text-ink-3 transition-colors duration-[120ms]',
  'hover:border-line-strong focus:border-accent focus:outline-none',
  'focus-visible:outline-none disabled:opacity-50',
].join(' ');

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(base, 'h-10', className)} {...props} />
  ),
);
Input.displayName = 'Input';

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(base, 'resize-y py-2.5 leading-relaxed', className)} {...props} />
));
Textarea.displayName = 'Textarea';

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select ref={ref} className={cn(base, 'h-10 cursor-pointer pr-8', className)} {...props} />
  ),
);
Select.displayName = 'Select';

/** Підпис + поле + пояснення. Підпис завжди над полем: так коротший шлях ока. */
export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink-2">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-[12px] text-err">{error}</p>
      ) : hint ? (
        <p className="text-[12px] text-ink-3">{hint}</p>
      ) : null}
    </div>
  );
}
