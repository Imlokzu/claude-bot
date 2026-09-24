import { useCallback, useEffect, useRef, useState } from 'react';
import { TextMessagePartProvider } from '@assistant-ui/react';
import { Check, ChevronRight, CircleSlash, SmilePlus, X } from 'lucide-react';
import { Orb } from '@/vendor/aicss';
import { toolLook } from '@/lib/toolLabels';
import { t as activityT } from '@/lib/i18n';
import { t } from '@/locales/chat';
import { cn } from '@/lib/cn';
import { Markdown } from './Markdown';
import { REPLY_ATTRIBUTE } from './SelectionActions';
import type { ToolStep } from './types';

/*
 * The pieces of a messenger-style reply: short bubbles, the line that says
 * what the bot is doing right now, typing dots, and emoji reactions.
 *
 * Reactions are content, not icons, so emoji are allowed here even though
 * DESIGN.md bans them as interface icons.
 */

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🙏', '👏'] as const;

/** OpenClaw prefixes our MCP tools (`tools__web_search`); the labels know the bare name. */
function lookOf(step: ToolStep) {
  return toolLook(step.label.replace(/^tools__/, ''));
}

function Payload({ value }: { value: unknown }) {
  return <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface px-3 py-2 font-mono text-[11px] leading-relaxed text-ink-2">{
    typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  }</pre>;
}

/** One tool call with its full input and result, for whoever wants to check. */
function ToolActivity({ step }: { step: ToolStep }) {
  const duration = step.startedAt && step.endedAt
    ? Math.max(0, (step.endedAt - step.startedAt) / 1000).toFixed(1) : null;
  return (
    <details className="group min-w-0 border-l border-line pl-3" data-tool-status={step.status}>
      <summary className="flex cursor-pointer list-none items-start gap-2 rounded-sm py-1.5 text-[12px] text-ink-2 outline-none transition-colors hover:bg-surface focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-details-marker]:hidden">
        <span className={cn('mt-0.5 shrink-0', step.status === 'failed' ? 'text-err' : step.status === 'done' ? 'text-ok' : 'text-ink-3')}>
          {step.status === 'active' ? <Orb variant={lookOf(step).orb} size={14} />
            : step.status === 'done' ? <Check className="size-3.5" />
              : step.status === 'failed' ? <X className="size-3.5" /> : <CircleSlash className="size-3.5" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="break-all font-mono font-medium text-ink">{step.label}</span>
            <span className={cn('font-sans text-[11px]', step.status === 'failed' && 'text-err')}>{activityT(`activity.${step.status}`)}</span>
            {duration !== null && <span className="font-mono text-[10px] text-ink-3">{activityT('activity.seconds', { seconds: duration })}</span>}
          </span>
          {step.detail && <span className="mt-0.5 block break-words font-sans text-ink-3">{step.detail}</span>}
        </span>
        <ChevronRight className="mt-0.5 size-3.5 shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none" />
      </summary>
      <div className="space-y-2 pb-3 pl-5">
        {step.input !== undefined && <section><p className="mb-1 font-sans text-[11px] text-ink-3">{activityT('activity.input')}</p><Payload value={step.input} /></section>}
        {step.result !== undefined
          ? <section><p className="mb-1 font-sans text-[11px] text-ink-3">{activityT(step.status === 'active' ? 'activity.partial' : 'activity.result')}</p><Payload value={step.result} /></section>
          : <p className="font-sans text-[11px] text-ink-3">{activityT('activity.noResult')}</p>}
      </div>
    </details>
  );
}

/**
 * What the bot is doing between two messages.
 *
 * Live, it is one line in the present tense ("шукаю в інтернеті · weather
 * Kyiv") that breathes while the tool runs. Once finished it folds into a
 * quiet "Done: …" row; opening it shows every call with its input and result.
 */
export function ActivityLine({ steps, running }: { steps: ToolStep[]; running: boolean }) {
  if (!steps.length) return null;
  const active = running ? steps.find((step) => step.status === 'active') : undefined;

  if (active) {
    const look = lookOf(active);
    return (
      <div role="status" className="flex min-w-0 max-w-full items-center gap-2 py-1 pl-1 text-[13px] text-ink-2" data-agent-activity>
        <span className="shrink-0"><Orb variant={look.orb} size={14} /></span>
        <span className="chat-live shrink-0">{look.verb}</span>
        {active.detail ? <span className="min-w-0 truncate text-ink-3">· {active.detail}</span> : null}
      </div>
    );
  }

  const failed = steps.some((step) => step.status === 'failed');
  const first = steps[0];
  const what = first.detail || lookOf(first).verb;
  const started = Math.min(...steps.map((step) => step.startedAt ?? Infinity));
  const ended = Math.max(...steps.map((step) => step.endedAt ?? -Infinity));
  const seconds = Number.isFinite(started) && Number.isFinite(ended) && ended >= started
    ? ((ended - started) / 1000).toFixed(1) : null;

  return (
    <details className="group min-w-0 max-w-full" data-agent-activity>
      <summary className="flex min-w-0 cursor-pointer list-none items-center gap-1.5 rounded-sm py-1 pl-1 text-[12px] text-ink-3 outline-none transition-colors hover:text-ink-2 focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-details-marker]:hidden">
        {failed ? <X className="size-3.5 shrink-0 text-err" /> : <Check className="size-3.5 shrink-0 text-ok" />}
        <span className="min-w-0 truncate">{t(failed ? 'steps.failed' : 'steps.done', { what })}</span>
        {steps.length > 1 ? <span className="shrink-0 font-mono text-[10px]">{t('steps.more', { count: steps.length - 1 })}</span> : null}
        {seconds !== null ? <span className="shrink-0 font-mono text-[10px]">{activityT('activity.seconds', { seconds })}</span> : null}
        <ChevronRight className="size-3.5 shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none" />
      </summary>
      <div className="mt-1 space-y-1 pl-1">
        {steps.map((step) => <ToolActivity key={step.id} step={step} />)}
      </div>
    </details>
  );
}

export function TypingBubble() {
  return (
    <div role="status" aria-label={t('typing.aria')}
      className="chat-bubble-in flex h-9 items-center gap-1 rounded-lg bg-surface-2 px-3.5">
      <span className="chat-dot size-1.5 rounded-full bg-ink-3" />
      <span className="chat-dot size-1.5 rounded-full bg-ink-3" />
      <span className="chat-dot size-1.5 rounded-full bg-ink-3" />
    </div>
  );
}

/** The small emoji badge hanging off a bubble's lower edge. */
export function ReactionChip({ emoji, label, onClick, align }: {
  emoji: string; label: string; onClick?: () => void; align: 'start' | 'end';
}) {
  const className = cn(
    'chat-reaction-in absolute -bottom-3 z-10 grid h-6 min-w-6 place-items-center rounded-full border border-line bg-surface px-1 text-[13px] leading-none shadow-raise',
    align === 'start' ? 'left-2.5' : 'right-2.5',
  );
  if (!onClick) return <span role="img" aria-label={label} className={className}>{emoji}</span>;
  return (
    <button type="button" aria-label={label} onClick={onClick}
      className={cn(className, 'transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent')}>
      {emoji}
    </button>
  );
}

function ReactionPicker({ current, onPick, onClose, boundary }: {
  current?: string;
  onPick: (emoji: string | null) => void;
  onClose: () => void;
  /** Clicks inside it (the toggle button included) are not "outside". */
  boundary: React.RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    const onDown = (event: PointerEvent) => {
      if (boundary.current && !boundary.current.contains(event.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [onClose, boundary]);

  return (
    <div ref={ref} role="menu" aria-label={t('reaction.pick')} data-state="open"
      className="u-pop absolute bottom-full left-0 z-20 mb-1.5 flex gap-0.5 rounded-full border border-line bg-surface p-1 shadow-pop">
      {QUICK_REACTIONS.map((emoji) => (
        <button key={emoji} type="button" role="menuitem"
          aria-label={emoji === current ? t('reaction.remove', { emoji }) : emoji}
          onClick={() => { onPick(emoji === current ? null : emoji); onClose(); }}
          className={cn(
            'grid size-8 place-items-center rounded-full text-[17px] transition-transform hover:scale-115 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none',
            emoji === current && 'bg-accent-soft',
          )}>
          {emoji}
        </button>
      ))}
    </div>
  );
}

/**
 * One grey bubble of the bot's reply. Hovering (or focusing) it reveals the
 * react button next to it, the way messengers do; on touch it stays visible.
 */
export function BotBubble({ text, note, running, reaction, onReact }: {
  text: string;
  /** Said while working rather than the answer — drawn a step quieter. */
  note?: boolean;
  running?: boolean;
  reaction?: string;
  /** Absent while the reply is still being written or cannot be addressed. */
  onReact?: (emoji: string | null) => void;
}) {
  const [picking, setPicking] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  // Stable, so the picker's listeners are not re-attached on every render.
  const closePicker = useCallback(() => setPicking(false), []);
  return (
    <div ref={row} className={cn('group/bubble relative flex max-w-full items-center gap-1', reaction && 'mb-3')}>
      <div {...{ [REPLY_ATTRIBUTE]: '' }}
        className={cn('chat-bubble-in relative min-w-0 max-w-full rounded-lg bg-surface-2 px-3.5 py-2', note && '[&_*]:text-ink-2')}>
        <TextMessagePartProvider text={text} isRunning={running}>
          <Markdown />
        </TextMessagePartProvider>
        {reaction ? (
          <ReactionChip emoji={reaction} align="start" label={t('reaction.yours', { emoji: reaction })}
            onClick={onReact ? () => onReact(null) : undefined} />
        ) : null}
      </div>
      {onReact ? (
        <button type="button" aria-label={t('reaction.add')} aria-haspopup="menu" aria-expanded={picking}
          onClick={() => setPicking((open) => !open)}
          className="grid size-7 shrink-0 place-items-center rounded-full text-ink-3 opacity-0 transition-opacity hover:bg-surface-2 hover:text-ink focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent group-hover/bubble:opacity-100 aria-expanded:opacity-100 max-[759px]:opacity-60 motion-reduce:transition-none">
          <SmilePlus className="size-4" />
        </button>
      ) : null}
      {picking && onReact ? (
        <ReactionPicker current={reaction} onPick={onReact} onClose={closePicker} boundary={row} />
      ) : null}
    </div>
  );
}
