import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './Button';

/*
 * Модальне вікно й нижня шухляда — один компонент із двома розкладками.
 * На телефоні модалка посеред екрана недосяжна великим пальцем, тому там
 * вміст приїжджає знизу (side="bottom").
 */

export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;

export function DialogContent({
  title,
  description,
  side = 'center',
  className,
  children,
}: {
  title: string;
  description?: string;
  side?: 'center' | 'bottom';
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay
        className="u-veil fixed inset-0 backdrop-blur-[2px]"
        style={{ background: 'var(--c-overlay)', zIndex: 'var(--z-modal)' }}
      />
      <RadixDialog.Content
        style={{ zIndex: 'var(--z-modal)' }}
        className={cn(
          'fixed border border-line bg-surface shadow-pop outline-none',
          // Вікно по центру виростає, шухляда знизу — приїжджає з-за краю.
          side === 'center' ? 'u-pop' : 'u-sheet',
          side === 'center'
            ? 'left-1/2 top-1/2 max-h-[85dvh] w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg'
            : 'u-safe-b inset-x-0 bottom-0 max-h-[85dvh] rounded-t-xl border-b-0',
          'flex flex-col',
          className,
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <RadixDialog.Title className="text-[15px] font-semibold text-ink">
              {title}
            </RadixDialog.Title>
            {description ? (
              <RadixDialog.Description className="mt-1 text-[13px] text-ink-3">
                {description}
              </RadixDialog.Description>
            ) : null}
          </div>
          <RadixDialog.Close asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Закрити">
              <X />
            </Button>
          </RadixDialog.Close>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}
