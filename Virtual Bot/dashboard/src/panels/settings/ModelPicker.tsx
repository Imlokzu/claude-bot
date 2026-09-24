import { useEffect, useMemo, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { t } from '@/locales/settings';
import { byLineup } from '@/panels/chat/modelCatalog';

/*
 * The chat-model control. A native select paints the operating system's
 * menu: no room to put Astra above Sol, and the chosen row is only a
 * checkmark in that system list. This one is ours, so the order and the
 * highlight are the ones the settings page asked for.
 */

export interface PickerModel {
  id: string;
  label: string;
}

export function ModelPicker({
  id,
  value,
  models,
  allowEmpty = false,
  disabled = false,
  onChange,
}: {
  id: string;
  value: string;
  models: PickerModel[];
  /** Image, voice, and the other roles can stay on the gateway default. */
  allowEmpty?: boolean;
  disabled?: boolean;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const list = useRef<HTMLUListElement>(null);
  const ordered = useMemo(() => [...models].sort(byLineup), [models]);
  const current = ordered.find((model) => model.id === value);
  const label = current?.label || (value ? value.split('/').pop() || value : t('settings.inherit'));

  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open]);

  const pick = (next: string) => {
    setOpen(false);
    if (next !== value) onChange(next);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          id={id}
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          className="group flex h-8 w-[220px] items-center justify-between gap-2 rounded-md border border-line bg-surface-2 px-2.5 text-left font-mono text-[12.5px] text-ink transition-colors hover:border-line-strong disabled:opacity-50 data-[state=open]:border-accent"
        >
          <span className="min-w-0 truncate">{label}</span>
          <ChevronDown className="size-3.5 shrink-0 text-ink-3 transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={6}
          collisionPadding={12}
          style={{ zIndex: 'var(--z-pop)' }}
          className="popup-shell u-pop w-[240px] rounded-lg border border-line bg-surface p-1 shadow-pop outline-none"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <ul ref={list} role="listbox" aria-labelledby={id} className="max-h-72 overflow-y-auto overscroll-contain">
            {allowEmpty ? (
              <PickerRow
                label={t('settings.inherit')}
                selected={value === ''}
                onPick={() => pick('')}
              />
            ) : null}
            {ordered.map((model) => (
              <PickerRow
                key={model.id}
                label={model.label}
                selected={model.id === value}
                onPick={() => pick(model.id)}
              />
            ))}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function PickerRow({ label, selected, onPick }: {
  label: string;
  selected: boolean;
  onPick: () => void;
}) {
  return (
    <li role="presentation">
      <button
        type="button"
        role="option"
        aria-selected={selected}
        onClick={onPick}
        className={cn(
          'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left font-mono text-[12.5px] transition-colors',
          selected ? 'bg-accent-soft text-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
        )}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <Check className={cn('size-3.5 shrink-0 text-accent', !selected && 'invisible')} />
      </button>
    </li>
  );
}
