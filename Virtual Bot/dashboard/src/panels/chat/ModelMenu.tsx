import { useEffect, useId, useMemo, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Brain, Check, ChevronDown, Eye, LifeBuoy, Search, X, Zap } from 'lucide-react';
import { Segmented } from '@/components/ui/Segmented';
import { cn } from '@/lib/cn';
import { t } from '@/locales/chat';
import type { BrainModel } from '@/lib/queries';
import { BrandLogo } from './BrandLogo';
import { BRAND_NAMES, arrange, hostOf, remember, type SortMode } from './modelCatalog';
import { thinkingLabel, useBrainChoice } from './useBrainChoice';
import { shortNumber } from './tokens';

/*
 * Which model answers, and how hard it thinks.
 *
 * One picker for every layout. On a phone it is the chat header's title; on
 * the desk it sits in the prompt bar where the vendor's pickers were. The
 * vendor list had no search and showed the catalog in its own order, which
 * was fine for five models and painful for sixty — so both layouts now get
 * the same searchable, grouped list (see modelCatalog.ts).
 */

const SORT_KEY = 'claudeBotModelSort';
const RECENT_KEY = 'claudeBotRecentModels';

/** Browser storage is a convenience here; the menu works without it. */
function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or blocked storage: the choice just is not remembered.
  }
}

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

function GroupHead({ brand, count }: { brand: string | null; count: number }) {
  if (!brand) return null;
  const title = brand === 'recent' ? t('models.recent')
    : brand === 'other' ? t('models.other')
      : brand === 'all' ? t('models.all')
      : BRAND_NAMES[brand as keyof typeof BRAND_NAMES];
  return (
    // Sticky, so a long group still says whose models you are scrolling.
    <li role="presentation" className="sticky top-0 z-[1] flex items-center gap-2 bg-surface px-2 pb-1 pt-2.5">
      <span className="u-label">{title}</span>
      <span className="font-mono text-[10px] text-ink-3">{count}</span>
    </li>
  );
}

function ModelRow({ model, id, current, active, showContext, onPick, onHover }: {
  model: BrainModel;
  id: string;
  current: boolean;
  active: boolean;
  /** Sorted by window size: show the number the order is based on. */
  showContext: boolean;
  onPick: () => void;
  onHover: () => void;
}) {
  const host = hostOf(model.id);
  return (
    <li
      id={id}
      role="option"
      aria-selected={current}
      data-active={active ? '' : undefined}
      onPointerEnter={onHover}
      // A mouse press must not steal focus from the search field, or the
      // arrow keys would stop working after the first hover-and-miss.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onPick}
      className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md px-2 text-left text-ink transition-colors data-[active]:bg-surface-2"
    >
      <BrandLogo model={model} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px]">{model.label}</span>
        {host ? <span className="block truncate font-mono text-[10.5px] text-ink-3">{host}</span> : null}
      </span>
      {showContext ? (
        <span className="shrink-0 font-mono text-[11px] text-ink-2">{model.context ? shortNumber(model.context) : '—'}</span>
      ) : null}
      {model.vision ? <Eye aria-label={t('trait.vision')} className="size-3.5 shrink-0 text-ink-3" /> : null}
      {model.fast ? (
        <Zap
          aria-label={model.seconds ? t('trait.fastSeconds', { seconds: model.seconds }) : t('trait.fast')}
          className="size-3.5 shrink-0 text-ink-3"
        />
      ) : null}
      {model.is_default ? <Brain aria-label={t('role.default')} className="size-3.5 shrink-0 text-ink-3" /> : null}
      {model.fallback ? <LifeBuoy aria-label={t('role.fallback')} className="size-3.5 shrink-0 text-ink-3" /> : null}
      <Check className={cn('size-4 shrink-0 text-accent', !current && 'invisible')} />
    </li>
  );
}

export function ModelMenu({ variant = 'header' }: {
  /** `header` is the phone chat title; `bar` sits inside the desktop prompt bar. */
  variant?: 'header' | 'bar';
}) {
  const brain = useBrainChoice();
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSortState] = useState<SortMode>(() => load<SortMode>(SORT_KEY, 'maker'));
  const [recent, setRecent] = useState<string[]>(() => load<string[]>(RECENT_KEY, []));
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const base = useId();

  const groups = useMemo(
    () => arrange(brain.models, { query, sort, recent }),
    [brain.models, query, sort, recent],
  );
  // One flat sequence for the arrow keys; a model can appear twice (recent
  // and its own group), so rows are addressed by position, not by id.
  const flat = useMemo(() => groups.flatMap((group) => group.models), [groups]);
  const cursor = Math.min(active, Math.max(0, flat.length - 1));

  const setSort = (next: SortMode) => {
    setSortState(next);
    save(SORT_KEY, next);
    setActive(0);
  };

  const pick = (model: BrainModel) => {
    brain.pickModel(model.id);
    const next = remember(recent, model.id);
    setRecent(next);
    save(RECENT_KEY, next);
    setOpen(false);
  };

  // Each opening starts clean: an old query would hide models without saying so.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
  }, [open]);

  // Keep the keyboard's row in view as the arrows walk past the edge.
  useEffect(() => {
    if (!open) return;
    document.getElementById(`${base}-${cursor}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, cursor, base]);

  const onKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!flat.length) return;
      setActive((cursor + (event.key === 'ArrowDown' ? 1 : flat.length - 1)) % flat.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (flat[cursor]) pick(flat[cursor]);
    }
  };

  const label = brain.currentModel?.label || (brain.loading ? t('composer.loading') : 'OpenClaw');
  const shownLevel = dragging ?? brain.thinking;
  const level = shownLevel ? thinkingLabel(shownLevel) : t('composer.asConfigured');
  let row = -1;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        {variant === 'header' ? (
          <button
            type="button"
            aria-label={t('composer.chooseModel')}
            className="group flex min-h-11 min-w-0 max-w-full items-center gap-1.5 rounded-md px-2.5 text-ink transition-colors hover:bg-surface-2 data-[state=open]:bg-surface-2"
          >
            {brain.currentModel ? <BrandLogo model={brain.currentModel} /> : null}
            <span className="truncate font-mono text-[15px] font-medium">{label}</span>
            <ChevronDown className="size-3.5 shrink-0 text-ink-3 transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none" />
          </button>
        ) : (
          <button
            type="button"
            aria-label={t('composer.chooseModel')}
            className="group flex h-8 min-w-0 max-w-[60%] items-center gap-1.5 rounded-md px-2 text-[12.5px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink data-[state=open]:bg-surface-2"
          >
            {brain.currentModel ? <BrandLogo model={brain.currentModel} className="size-3.5" /> : null}
            <span className="truncate">{label}</span>
            <span className="shrink-0 font-mono text-[11px] text-ink-3">· {level}</span>
            <ChevronDown className="size-3 shrink-0 text-ink-3 transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none" />
          </button>
        )}
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side={variant === 'header' ? 'bottom' : 'top'}
          align={variant === 'header' ? 'center' : 'start'}
          sideOffset={6}
          collisionPadding={12}
          style={{ zIndex: 'var(--z-pop)' }}
          className="u-pop flex max-h-[min(78dvh,620px)] w-[min(360px,calc(100vw-24px))] flex-col rounded-lg border border-line bg-surface shadow-pop"
          // On touch the keyboard would cover half the list the moment the
          // menu opens; there the search waits for a tap.
          // First Escape clears the search, the second closes the menu.
          // Radix sees the key before the input does, so it is decided here.
          onEscapeKeyDown={(event) => {
            if (!query) return;
            event.preventDefault();
            setQuery('');
            setActive(0);
          }}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            if (!window.matchMedia('(pointer: coarse)').matches) input.current?.focus();
          }}
        >
          <div className="space-y-2 border-b border-line p-2.5">
            <label className="flex h-9 items-center gap-2 rounded-md bg-surface-2 px-2.5 focus-within:ring-2 focus-within:ring-accent max-[759px]:h-11">
              <Search className="size-4 shrink-0 text-ink-3" />
              <input
                ref={input}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
                onKeyDown={onKey}
                placeholder={t('models.search')}
                aria-label={t('models.search')}
                role="combobox"
                aria-expanded="true"
                aria-controls={`${base}-list`}
                aria-activedescendant={flat.length ? `${base}-${cursor}` : undefined}
                autoComplete="off"
                spellCheck={false}
                className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3 max-[759px]:text-[16px]"
              />
              {query ? (
                <button
                  type="button"
                  aria-label={t('models.clear')}
                  onClick={() => {
                    setQuery('');
                    input.current?.focus();
                  }}
                  className="grid size-6 place-items-center rounded-sm text-ink-3 hover:text-ink"
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </label>
            <Segmented<SortMode>
              size="sm"
              ariaLabel={t('models.sort')}
              value={sort}
              onChange={setSort}
              className="w-full"
              items={[
                { value: 'maker', label: t('models.sortMaker') },
                { value: 'name', label: t('models.sortName') },
                { value: 'context', label: t('models.sortContext') },
              ]}
            />
          </div>

          <ul
            id={`${base}-list`}
            role="listbox"
            aria-label={t('composer.models')}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-1.5"
          >
            {groups.map((group) => (
              <GroupBlock key={group.key}>
                {/* A flat list needs no heading on its own, but under the
                    recent picks it does — or it reads as more of them. */}
                <GroupHead brand={group.brand ?? (groups.length > 1 ? 'all' : null)} count={group.models.length} />
                {group.models.map((model) => {
                  row += 1;
                  const index = row;
                  return (
                    <ModelRow
                      key={`${group.key}-${model.id}`}
                      id={`${base}-${index}`}
                      model={model}
                      current={model.id === brain.current}
                      active={index === cursor}
                      showContext={sort === 'context'}
                      onHover={() => setActive(index)}
                      onPick={() => pick(model)}
                    />
                  );
                })}
              </GroupBlock>
            ))}
            {!flat.length ? (
              <li className="px-2 py-4 text-center text-[13px] text-ink-3">
                {brain.models.length ? t('models.none', { query }) : t('composer.loading')}
              </li>
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

/** Groups are fragments in the listbox: options must stay its direct children. */
function GroupBlock({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
