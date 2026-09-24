import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { TextMessagePartProvider } from '@assistant-ui/react';
import { ChevronRight, CloudSun, Coins, FileText, Folder, Image as ImageIcon, ListTodo, MessageCircleQuestion, Music, Play, Search, SmilePlus, type LucideIcon } from 'lucide-react';
import { t as activityT } from '@/lib/i18n';
import { t, type ChatKey } from '@/locales/chat';
import { cn } from '@/lib/cn';
import { Markdown } from './Markdown';
import { REPLY_ATTRIBUTE } from './SelectionActions';
import type { ToolStep } from './types';

/*
 * The pieces of a messenger-style reply: short bubbles, the line that says
 * what the bot is doing right now, typing dots, and emoji reactions.
 *
 * Two motions carry the messenger feel. The typing dots shrink away inside
 * their own bubble (and a reply that replaces them crossfades out of those
 * dots). When the bot reacts, three beats follow: the text bubble rises and
 * slowly turns from a pill into a circle, the emoji appears, then that
 * circle travels faster and lands as the reaction. A reaction the person
 * picks flies from the button instead.
 *
 * Reactions are content, not icons, so emoji are allowed here even though
 * DESIGN.md bans them as interface icons.
 */

/** How long the typing bubble takes to collapse. The runtime holds a
 *  reaction-only draft at least this long, so the collapse is not cut off.
 *  Kept in step with `chat-typing-out` in base.css. */
export const TYPING_LEAVE_MS = 780;

/** Rise and pill-to-circle. Slow, and it finishes before anything travels. */
const TRANSFORM_MS = 1100;
/** The emoji shows in the finished circle, then the trip starts. */
const EMOJI_MS = 240;
/** The circle's trip to the message. Shorter than the transform on purpose. */
const TRAVEL_MS = 380;
/** Kept in step with the morph fades in base.css. */
const MORPH_MS = TRANSFORM_MS + EMOJI_MS + TRAVEL_MS;
/** Kept in step with `chat-emoji-flight` in base.css. */
const FLIGHT_MS = 1100;
/** Chip stays hidden until the circle lands. Matches `.chat-reaction-land`. */
export const LAND_DELAY_MS = MORPH_MS - 40;
/** A reaction picked from the button arrives with the shorter flight. */
export const FLIGHT_LAND_MS = 920;

export function typingLeaveMs(): number {
  if (typeof window === 'undefined') return TYPING_LEAVE_MS;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : TYPING_LEAVE_MS;
}

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🙏', '👏'] as const;

/** OpenClaw prefixes our MCP tools (`tools__web_search`); the labels know the bare name. */
function bareTool(label: string): string {
  return label.replace(/^(?:tools|workspace|emotions)__/, '');
}

const TOOL_ICONS: Record<string, LucideIcon> = {
  web_search: Search,
  image_search: ImageIcon,
  facts: FileText,
  weather: CloudSun,
  currency: Coins,
  memory_search: Search,
  workspace_read: FileText,
  workspace_write: FileText,
  workspace_list: Folder,
  workspace_show: FileText,
  workspace_info: FileText,
  ask_question: MessageCircleQuestion,
  todo_list: ListTodo,
  show_choice: ListTodo,
  play_music: Music,
  stop_music: Music,
  play_video: Play,
  listen_to_video: Play,
  video_control: Play,
};

const TOOL_TITLES: Record<string, ChatKey> = {
  web_search: 'tool.web_search',
  image_search: 'tool.image_search',
  facts: 'tool.facts',
  weather: 'tool.weather',
  currency: 'tool.currency',
  memory_search: 'tool.memory_search',
  workspace_read: 'tool.workspace_read',
  workspace_write: 'tool.workspace_write',
  workspace_list: 'tool.workspace_list',
  workspace_show: 'tool.workspace_show',
  ask_question: 'tool.ask_question',
  todo_list: 'tool.todo_list',
  show_choice: 'tool.show_choice',
  play_music: 'tool.play_music',
  play_video: 'tool.play_video',
};

function toolTitle(label: string): string {
  const name = bareTool(label);
  const key = TOOL_TITLES[name];
  if (key) return t(key);
  return name.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function ToolIcon({ label }: { label: string }) {
  const Icon = TOOL_ICONS[bareTool(label)] ?? Search;
  return <Icon className="size-3.5" strokeWidth={1.75} />;
}

/** Clerk and other sign-in failures arrive as a JSON blob. The card says so in words. */
function needsSignIn(result: unknown): boolean {
  const text = typeof result === 'string' ? result : JSON.stringify(result ?? '');
  return /clerk|sign-?in|потрібен вхід|нужен вход|unauthorized/i.test(text);
}

function Payload({ value }: { value: unknown }) {
  return <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface px-3 py-2 font-mono text-[11px] leading-relaxed text-ink-2">{
    typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  }</pre>;
}

/** The raw call, folded under the card. Height eases open and the text rises in. */
function ToolLogs({ step }: { step: ToolStep }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1">
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1 text-[11px] text-ink-3 outline-none hover:text-ink-2 focus-visible:ring-2 focus-visible:ring-accent">
        <ChevronRight className={cn('size-3 transition-transform duration-200 motion-reduce:transition-none', open && 'rotate-90')} />
        {t('tool.logs')}
      </button>
      <div className="chat-log" data-open={open ? '' : undefined}>
        <div className="chat-log-clip">
          <div className="chat-log-panel space-y-2 pt-1.5">
            {step.input !== undefined && <section><p className="mb-1 text-[11px] text-ink-3">{activityT('activity.input')}</p><Payload value={step.input} /></section>}
            {step.result !== undefined
              ? <section><p className="mb-1 text-[11px] text-ink-3">{activityT(step.status === 'active' ? 'activity.partial' : 'activity.result')}</p><Payload value={step.result} /></section>
              : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * One tool, the way a person reads it: an icon, a name, what it was asked,
 * and whether it worked. The raw call stays behind Logs.
 */
function ToolCard({ step }: { step: ToolStep }) {
  const signedOut = step.status === 'failed' && needsSignIn(step.result);
  const hasLog = step.input !== undefined || step.result !== undefined;
  return (
    <div className="flex min-w-0 max-w-full items-start gap-2.5 rounded-lg border border-line bg-surface-2 px-3 py-2" data-tool-status={step.status}>
      <span className={cn(
        'grid size-7 shrink-0 place-items-center rounded-md bg-surface',
        step.status === 'failed' ? 'text-err' : step.status === 'done' ? 'text-ok' : 'text-ink-2',
      )}>
        {step.status === 'active' ? <span className="chat-live"><ToolIcon label={step.label} /></span> : <ToolIcon label={step.label} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-5 text-ink">{toolTitle(step.label)}</p>
        {step.detail ? <p className="truncate text-[12px] leading-5 text-ink-3">{step.detail}</p> : null}
        <p className={cn('text-[12px] leading-5', step.status === 'failed' ? 'text-err' : step.status === 'done' ? 'text-ok' : 'text-ink-3')}>
          {activityT(`activity.${step.status}`)}
          {signedOut ? ` · ${t('tool.signIn')}` : ''}
        </p>
        {hasLog ? <ToolLogs step={step} /> : null}
      </div>
    </div>
  );
}

/**
 * What the bot is doing between two messages.
 *
 * Each tool is its own card — name, the thing it was given, and a status —
 * rather than the raw call. While one is still running, that card breathes.
 */
export function ActivityLine({ steps, running }: { steps: ToolStep[]; running: boolean }) {
  if (!steps.length) return null;
  return (
    <div className="flex w-full min-w-0 max-w-full flex-col gap-1.5" data-agent-activity data-running={running ? '' : undefined}>
      {steps.map((step) => <ToolCard key={step.id} step={step} />)}
    </div>
  );
}

export function TypingBubble({ leaving = false }: { leaving?: boolean }) {
  return (
    <div
      role="status"
      aria-label={leaving ? undefined : t('typing.aria')}
      aria-hidden={leaving || undefined}
      data-typing=""
      className={cn(
        'chat-bubble-in liquid-glass flex h-9 items-center gap-1.5 rounded-full px-4',
        leaving && 'chat-typing-out',
      )}
    >
      <span className="chat-dot size-2 rounded-full bg-ink-3" />
      <span className="chat-dot size-2 rounded-full bg-ink-3" />
      <span className="chat-dot size-2 rounded-full bg-ink-3" />
    </div>
  );
}

/*
 * A reaction travels as one fixed emoji, then the chip fades in where it
 * lands. Fixed, and portaled to the body, because the thread scrolls and a
 * transformed ancestor would otherwise trap it.
 */
type FlightSpec = {
  emoji: string;
  x: number; y: number;
  dx: number; dy: number;
  mx: number; my: number;
};

const FlightContext = createContext<(spec: FlightSpec) => boolean>(() => false);

export function EmojiFlights({ children }: { children: ReactNode }) {
  const [flights, setFlights] = useState<(FlightSpec & { id: number })[]>([]);
  const launch = useCallback((spec: FlightSpec) => {
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    const id = flightSeq++;
    setFlights((current) => [...current, { ...spec, id }]);
    window.setTimeout(() => {
      setFlights((current) => current.filter((item) => item.id !== id));
    }, FLIGHT_MS + 20);
    return true;
  }, []);
  return (
    <FlightContext value={launch}>
      {children}
      {typeof document !== 'undefined' ? createPortal(
        flights.map((flight) => (
          <span
            key={flight.id}
            aria-hidden
            className="chat-emoji-flight"
            style={{
              '--x': flight.x,
              '--y': flight.y,
              '--dx': flight.dx,
              '--dy': flight.dy,
              '--mx': flight.mx,
              '--my': flight.my,
            } as CSSProperties}
          >{flight.emoji}</span>
        )),
        document.body,
      ) : null}
    </FlightContext>
  );
}

let flightSeq = 0;

export function useEmojiFlight() {
  return useContext(FlightContext);
}

function centerOf(rect: DOMRect) {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/** Where the chip sits: centered on the bubble's bottom edge, inset from a side. */
export function reactionTarget(bubble: DOMRect, align: 'start' | 'end') {
  return {
    x: align === 'start' ? bubble.left + 22 : bubble.right - 22,
    y: bubble.bottom,
  };
}

/** Bow the path sideways so a picked emoji arcs instead of sliding straight.
 *  `lift` is the text bubble that is leaving. It rises and slowly becomes a
 *  circle, the emoji appears, and only then does the circle travel — faster —
 *  onto the message. The bot mark stays where it is. */
export function flyEmoji(
  launch: (spec: FlightSpec) => boolean,
  emoji: string,
  from: DOMRect,
  to: { x: number; y: number },
  lift?: Element | null,
): boolean {
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return false;
  }
  const send = (origin: DOMRect) => {
    const start = centerOf(origin);
    const dx = to.x - start.x;
    const dy = to.y - start.y;
    const len = Math.hypot(dx, dy) || 1;
    const bow = Math.max(64, Math.min(120, len * 0.62));
    return launch({
      emoji,
      x: start.x,
      y: start.y,
      dx,
      dy,
      mx: dx * 0.5 + (-dy / len) * bow,
      my: dy * 0.5 + (dx / len) * bow,
    });
  };
  if (!lift || !lift.isConnected) return send(from);
  morphBubble(lift, emoji, to);
  return true;
}

/** A fixed copy of the text bubble, so the real message (and the bot mark)
 *  stay put while the copy becomes the reaction. */
function morphBubble(bubble: Element, emoji: string, to: { x: number; y: number }) {
  const rect = bubble.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return;
  const ghost = bubble.cloneNode(true) as HTMLElement;
  ghost.classList.remove('chat-bubble-in', 'chat-bubble-open', 'chat-typing-out');
  ghost.classList.add('chat-morph');
  ghost.removeAttribute('data-typing');
  ghost.setAttribute('aria-hidden', 'true');
  const badge = document.createElement('span');
  badge.className = 'chat-morph-emoji';
  badge.textContent = emoji;
  ghost.appendChild(badge);
  const radius = getComputedStyle(bubble).borderRadius || '12px';
  ghost.style.animation = 'none';
  ghost.style.position = 'fixed';
  ghost.style.margin = '0';
  ghost.style.zIndex = '40';
  ghost.style.pointerEvents = 'none';
  ghost.style.overflow = 'hidden';
  ghost.style.padding = '0';
  document.body.appendChild(ghost);
  // The typing pill is on its way out; the copy is the thing that travels.
  if (bubble instanceof HTMLElement && bubble.hasAttribute('data-typing')) {
    bubble.style.visibility = 'hidden';
  }

  const width = rect.width;
  const height = rect.height;
  const circle = Math.round(Math.max(32, Math.min(height, 40)));
  const chip = 22;
  const startCx = rect.left + width / 2;
  const startCy = rect.top + height / 2;
  const risenCy = startCy - 26;
  const dx = to.x - startCx;
  const dy = to.y - risenCy;
  const len = Math.hypot(dx, dy) || 1;
  const bow = Math.min(22, len * 0.14);
  const cpx = startCx + dx * 0.5 + (-dy / len) * bow;
  const cpy = risenCy + dy * 0.5 + (dx / len) * bow;
  const along = (t: number) => {
    const u = 1 - t;
    return {
      x: u * u * startCx + 2 * u * t * cpx + t * t * to.x,
      y: u * u * risenCy + 2 * u * t * cpy + t * t * to.y,
    };
  };
  const box = (cx: number, cy: number, w: number, h: number, round: string) => ({
    left: `${cx - w / 2}px`,
    top: `${cy - h / 2}px`,
    width: `${w}px`,
    height: `${h}px`,
    borderRadius: round,
  });
  const size = (t: number) => circle + (chip - circle) * t;
  const at = (t: number) => {
    const p = along(t);
    const s = size(t);
    return box(p.x, p.y, s, s, '999px');
  };
  const formed = box(startCx, risenCy, circle, circle, '999px');
  const transformEnd = TRANSFORM_MS / MORPH_MS;
  const travelStart = (TRANSFORM_MS + EMOJI_MS) / MORPH_MS;

  ghost.animate([
    { ...box(startCx, startCy, width, height, radius), offset: 0, easing: 'cubic-bezier(0.22, 0.7, 0.2, 1)' },
    { ...formed, offset: transformEnd, easing: 'linear' },
    { ...formed, offset: travelStart, easing: 'cubic-bezier(0.45, 0.02, 0.2, 1)' },
    { ...at(0.55), offset: travelStart + (1 - travelStart) * 0.55 },
    { ...at(1), offset: 1 },
  ], { duration: MORPH_MS, fill: 'forwards' });
  window.setTimeout(() => ghost.remove(), MORPH_MS + 40);
}

/** The small emoji badge hanging off a bubble's lower edge. */
export function ReactionChip({ emoji, label, onClick, align, landing, delayMs = LAND_DELAY_MS }: {
  emoji: string; label: string; onClick?: () => void; align: 'start' | 'end';
  /** True while an emoji is still in flight towards this chip. */
  landing?: boolean;
  /** When that flight arrives. The text-bubble morph is the default. */
  delayMs?: number;
}) {
  const className = cn(
    'absolute -bottom-3 z-10 grid h-6 min-w-6 place-items-center rounded-full border border-line bg-surface px-1 text-[13px] leading-none shadow-raise',
    landing ? 'chat-reaction-land' : 'chat-reaction-in',
    align === 'start' ? 'left-2.5' : 'right-2.5',
  );
  if (!onClick) return <span role="img" aria-label={label} className={className} style={landing ? { animationDelay: `${delayMs}ms` } : undefined}>{emoji}</span>;
  return (
    <button type="button" aria-label={label} onClick={onClick}
      style={landing ? { animationDelay: `${delayMs}ms` } : undefined}
      className={cn(className, 'transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent')}>
      {emoji}
    </button>
  );
}

function ReactionPicker({ current, onPick, onClose, boundary }: {
  current?: string;
  onPick: (emoji: string | null, source?: HTMLElement) => void;
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
          onClick={(event) => { onPick(emoji === current ? null : emoji, event.currentTarget); onClose(); }}
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
export function BotBubble({ text, note, running, reaction, onReact, fromTyping }: {
  text: string;
  /** Said while working rather than the answer — drawn a step quieter. */
  note?: boolean;
  running?: boolean;
  reaction?: string;
  /** Absent while the reply is still being written or cannot be addressed. */
  onReact?: (emoji: string | null) => void;
  /** This bubble took the place of the typing dots, so the dots fade inside it. */
  fromTyping?: boolean;
}) {
  const [picking, setPicking] = useState(false);
  const [flying, setFlying] = useState<string | null>(null);
  const [dots, setDots] = useState(fromTyping);
  const row = useRef<HTMLDivElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const launch = useEmojiFlight();
  // Stable, so the picker's listeners are not re-attached on every render.
  const closePicker = useCallback(() => setPicking(false), []);
  useEffect(() => {
    if (!fromTyping) {
      setDots(false);
      return;
    }
    setDots(true);
    const id = window.setTimeout(() => setDots(false), typingLeaveMs());
    return () => window.clearTimeout(id);
  }, [fromTyping]);
  const pick = (emoji: string | null, source?: HTMLElement) => {
    if (emoji && source && bubble.current
      && flyEmoji(launch, emoji, source.getBoundingClientRect(), reactionTarget(bubble.current.getBoundingClientRect(), 'start'))) {
      setFlying(emoji);
    } else {
      setFlying(null);
    }
    onReact?.(emoji);
  };
  return (
    <div ref={row} className={cn('group/bubble relative flex max-w-full items-center gap-1', reaction && 'mb-3')}>
      <div ref={bubble} {...{ [REPLY_ATTRIBUTE]: '' }}
        className={cn(
          'chat-bubble-in liquid-glass relative min-w-0 max-w-full rounded-lg px-3.5 py-2',
          fromTyping && 'chat-bubble-open',
          note && '[&_*]:text-ink-2',
        )}>
        {dots ? (
          <span aria-hidden data-typing="" className="chat-dots-leave pointer-events-none absolute inset-y-0 left-3.5 flex items-center gap-1.5">
            <span className="chat-dot size-2 rounded-full bg-ink-3" />
            <span className="chat-dot size-2 rounded-full bg-ink-3" />
            <span className="chat-dot size-2 rounded-full bg-ink-3" />
          </span>
        ) : null}
        <div className={fromTyping ? 'chat-text-in' : undefined}>
          <TextMessagePartProvider text={text} isRunning={running}>
            <Markdown />
          </TextMessagePartProvider>
        </div>
        {reaction ? (
          <ReactionChip key={reaction} emoji={reaction} align="start" landing={flying === reaction} delayMs={FLIGHT_LAND_MS}
            label={t('reaction.yours', { emoji: reaction })}
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
        <ReactionPicker current={reaction} onPick={pick} onClose={closePicker} boundary={row} />
      ) : null}
    </div>
  );
}
