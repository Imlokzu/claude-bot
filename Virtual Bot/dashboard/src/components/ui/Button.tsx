import { forwardRef } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '@/lib/cn';

/*
 * Кнопка. П'ять варіантів — більше не потрібно, і кожен має власну роль:
 *
 *   solid   — головна дія екрана. На екрані вона одна (DESIGN.md, правило 3).
 *   outline — рівнозначна альтернатива головній дії.
 *   ghost   — дія, яку не шукають очима: «очистити», «сховати».
 *   danger  — незворотне. Для справді незворотного бери SlideCommit.
 *   icon    — квадратна, лише іконка; обов'язковий aria-label.
 */
const button = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap select-none',
    'font-medium transition-[background-color,border-color,color,transform] duration-[120ms]',
    'active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45',
    '[&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        solid: 'bg-accent text-accent-ink hover:brightness-[1.06]',
        outline: 'border border-line-strong text-ink hover:bg-surface-2',
        ghost: 'text-ink-2 hover:bg-surface-2 hover:text-ink',
        danger: 'bg-err text-white hover:brightness-110',
        quiet: 'bg-surface-2 text-ink hover:bg-surface-3',
      },
      size: {
        sm: 'h-8 rounded-sm px-3 text-[13px] [&_svg]:size-[15px] max-[759px]:h-11',
        md: 'h-10 rounded-md px-4 text-sm [&_svg]:size-[17px]',
        lg: 'h-12 rounded-md px-5 text-[15px] [&_svg]:size-[19px]',
        icon: 'size-10 rounded-md [&_svg]:size-[18px] max-[759px]:size-11',
        'icon-sm': 'size-8 rounded-sm [&_svg]:size-[16px] max-[759px]:size-11',
      },
    },
    defaultVariants: { variant: 'quiet', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {
  /** Відрендерити як дочірній елемент (напр. <a>), зберігши стилі. */
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, type = 'button', ...props }, ref) => {
    const Component = asChild ? Slot : 'button';
    return (
      <Component
        ref={ref}
        type={asChild ? undefined : type}
        className={cn(button({ variant, size }), className)}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';
