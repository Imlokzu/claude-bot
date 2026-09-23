import { useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronDown, Eye, Zap } from 'lucide-react';
import { cn } from '@/lib/cn';
import { t } from '@/locales/chat';
import { thinkingLabel, useBrainChoice } from './useBrainChoice';

/*
 * The phone chat header's title: which model answers, and how hard it
 * thinks.
 *
 * On a phone the prompt bar has no room for two pickers beside the text —
 * they squeezed the field to a few words and pushed the model name into an
 * ellipsis. The model is also a property of the whole conversation rather
 * than of the next line, so the header is where it belongs: always visible,
 * one tap to change.
 */

/**
 * Thinking level as a row of stops on a track.
 *
 * A radio group rather than a range: the levels are named settings, not a
 * quantity, and "not set" is a real state with no position on the track —
 * then no stop is lit. Dragging along the track previews a level and lets go
 * to commit it, because every commit rewrites the OpenClaw config.
 */
function EffortStops({ levels, value, onPick, onPreview }: {
  levels: string[];
  value: string;
  onPick: (level: string) => void;
  /** The level under the finger mid-drag, or null once it lifts. */
  onPreview: (level: string | null) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [preview, setPreviewIndex] = useState<number | null>(null);
  const setPreview = (index: number | null) => {
    setPreviewIndex(index);
    onPreview(index === null ? null : levels[index]);
  };
  const chosen = levels.indexOf(value);
  const shown = preview ?? chosen;

  const indexAt = (clientX: number): number => {
    const rect = track.current!.getBoundingClientRect();
    const k = (clientX - rect.left) / Math.max(1, rect.width);
    return Math.max(0, Math.min(levels.length - 1, Math.round(k * (levels.length - 1))));
  };

  const onKey = (event: React.KeyboardEvent) => {
    const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = Math.max(0, Math.min(levels.length - 1, (chosen === -1 ? 0 : chosen + step)));
    onPick(levels[next]);
    // Keep focus on the lit stop, as a radio group does.
    track.current?.querySelectorAll<HTMLButtonElement>('[role=radio]')[next]?.focus();
  };

  const at = (index: number) => `${(index / Math.max(1, levels.length - 1)) * 100}%`;

  return (
    <div
      ref={track}
      role="radiogroup"
      aria-label={t('composer.chooseEffort')}
      className="relative mx-2.5 h-10 touch-none"
      onKeyDown={onKey}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        setPreview(indexAt(event.clientX));
      }}
      onPointerMove={(event) => {
        if (preview !== null) setPreview(indexAt(event.clientX));
      }}
      onPointerUp={() => {
        if (preview === null) return;
        onPick(levels[preview]);
        setPreview(null);
      }}
      onPointerCancel={() => setPreview(null)}
    >
      <span className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-surface-3" />
      {shown >= 0 ? (
        <span
          className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-accent transition-[width] duration-150 motion-reduce:transition-none"
          style={{ width: at(shown) }}
        />
      ) : null}
      {levels.map((level, index) => (
        <button
          key={level}
          type="button"
          role="radio"
          aria-checked={index === chosen}
          aria-label={thinkingLabel(level)}
          tabIndex={index === (chosen === -1 ? 0 : chosen) ? 0 : -1}
          // The track commits pointer picks. A click with `detail === 0` came
          // from Enter or Space, which the track never sees — commit that one
          // here, and only that one, so a tap does not commit twice.
          onClick={(event) => {
            if (event.detail === 0) onPick(level);
          }}
          className="absolute top-1/2 grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent"
          style={{ left: at(index) }}
        >
          <span
            className={cn(
              'block rounded-full transition-[width,height,background-color] duration-150 motion-reduce:transition-none',
              index === shown ? 'size-3.5 bg-ink' : index < shown ? 'size-2 bg-accent' : 'size-2 bg-line-strong',
            )}
          />
        </button>
      ))}
    </div>
  );
}

export function ModelMenu() {
  const brain = useBrainChoice();
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);

  const label = brain.currentModel?.label || (brain.loading ? t('composer.loading') : 'OpenClaw');
  const shownLevel = dragging ?? brain.thinking;
  const level = shownLevel ? thinkingLabel(shownLevel) : t('composer.asConfigured');

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={t('composer.chooseModel')}
          className="flex min-h-11 min-w-0 max-w-full items-center gap-1 rounded-md px-2.5 text-ink transition-colors hover:bg-surface-2 data-[state=open]:bg-surface-2"
        >
          <span className="truncate font-mono text-[15px] font-medium">{label}</span>
          <ChevronDown className="size-3.5 shrink-0 text-ink-3 transition-transform in-data-[state=open]:rotate-180 motion-reduce:transition-none" />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="center"
          sideOffset={6}
          collisionPadding={12}
          style={{ zIndex: 'var(--z-pop)' }}
          className="u-pop flex max-h-[min(70dvh,560px)] w-[min(340px,calc(100vw-24px))] flex-col rounded-lg border border-line bg-surface shadow-pop"
        >
          <p className="u-label px-3 pb-1.5 pt-3">{t('composer.models')}</p>
          <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5" role="listbox" aria-label={t('composer.models')}>
            {brain.models.map((model) => (
              <li key={model.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={model.id === brain.current}
                  onClick={() => {
                    brain.pickModel(model.id);
                    setOpen(false);
                  }}
                  className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left transition-colors hover:bg-surface-2"
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink">{model.label}</span>
                  {model.vision ? <Eye aria-label={t('trait.vision')} className="size-3.5 shrink-0 text-ink-3" /> : null}
                  {model.fast ? <Zap aria-label={t('trait.fast')} className="size-3.5 shrink-0 text-ink-3" /> : null}
                  <Check className={cn('size-4 shrink-0 text-accent', model.id !== brain.current && 'invisible')} />
                </button>
              </li>
            ))}
            {!brain.models.length ? (
              <li className="px-2 py-3 text-[13px] text-ink-3">{t('composer.loading')}</li>
            ) : null}
          </ul>

          {brain.levels.length ? (
            <section className="border-t border-line px-3 pb-3 pt-2.5">
              <div className="mb-0.5 flex items-baseline gap-2">
                <span className="u-label">{t('composer.effort')}</span>
                <span className="ml-auto font-mono text-[12px] text-ink">{level}</span>
              </div>
              <div className="flex justify-between font-mono text-[10.5px] text-ink-3">
                <span>{t('composer.faster')}</span>
                <span>{t('composer.smarter')}</span>
              </div>
              <EffortStops levels={brain.levels} value={brain.thinking} onPick={brain.pickThinking} onPreview={setDragging} />
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 text-[11px] leading-snug text-ink-3">{t('composer.effortHintShort')}</p>
                {brain.thinking ? (
                  <button
                    type="button"
                    onClick={() => brain.pickThinking('')}
                    className="shrink-0 rounded-sm px-2 py-1 font-mono text-[11px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink max-[759px]:py-2"
                  >
                    {t('composer.asConfigured')}
                  </button>
                ) : null}
              </div>
            </section>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
