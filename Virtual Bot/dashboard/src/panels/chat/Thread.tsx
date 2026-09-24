import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { MessagePrimitive, ThreadPrimitive, useAuiState } from '@assistant-ui/react';
import { ArrowDown } from 'lucide-react';
import { GalleryScope } from './Gallery';
import { cn } from '@/lib/cn';
import { TextType } from '@/vendor/reactbits';
import {
  ActivityLine, BotBubble, EmojiFlights, ReactionChip, TypingBubble,
  flyEmoji, reactionTarget, typingLeaveMs, useEmojiFlight,
} from './Bubbles';
import { SourceStrip } from './SourceStrip';
import { MessageActions } from './MessageActions';
import { stepsFor } from './replyParts';
import { Button } from '@/components/ui/Button';
import { BotIcon } from '@/components/ui/BotIcon';
import { glue } from '@/lib/glue';
import { t as activityT } from '@/lib/i18n';
import { t } from '@/locales/chat';
import type { ReplyPart, ToolStep } from './types';
import type { AgentStatus } from '@/lib/chatStream';

/*
 * The conversation, drawn like a messenger (owner's request, 2026-09-24).
 *
 * The person's message is a dark bubble on the right. The bot answers in a
 * run of short grey bubbles on the left, and between them says what it is
 * doing right now — "one sec, looking" → searching… → "found it". Either
 * side can react to the other with an emoji.
 */

const SUGGESTIONS = ['thread.suggestion1', 'thread.suggestion2', 'thread.suggestion3'] as const;

/*
 * Retry belongs to the conversation, not to a message: it re-sends the last
 * question. So the thread is told which reply is the last settled one, and
 * only that reply offers the action — on an older one the button would
 * silently replace something else.
 */
const RetryContext = createContext<{ id: string; run: () => void } | null>(null);

/** Reacting belongs to the conversation runtime; bubbles only report the pick. */
type OnReact = (messageId: string, bubble: number, emoji: string | null) => void;
const ReactContext = createContext<OnReact | null>(null);

/*
 * The typing pill and the bubble that replaces it have to agree on one
 * render, so this is derived during render rather than after an effect
 * (an effect would flash the pill away for a frame first).
 *
 * A new text bubble while the pill is up absorbs it: the dots fade inside
 * that bubble, and if the bot is still working the pill returns afterwards.
 * Anything else that ends the typing (a tool line, a reaction with no text)
 * collapses the pill itself.
 */
function useBubbleMotion(typing: boolean, textCount: number) {
  const [snap, setSnap] = useState({ typing, texts: textCount, born: -1 });
  const [pill, setPill] = useState<'show' | 'hide' | 'leave'>(typing ? 'show' : 'hide');
  const [prev, setPrev] = useState({ typing, texts: textCount });

  const grew = textCount > prev.texts;
  const absorb = prev.typing && grew;
  if (typing !== prev.typing || textCount !== prev.texts) {
    const born = absorb ? textCount - 1 : snap.born;
    setPrev({ typing, texts: textCount });
    setSnap({ typing, texts: textCount, born });
    if (absorb) setPill('hide');
    else if (typing) setPill('show');
    else if (prev.typing) setPill('leave');
    else setPill('hide');
  }

  useEffect(() => {
    if (pill === 'leave') {
      const id = window.setTimeout(() => setPill('hide'), typingLeaveMs());
      return () => window.clearTimeout(id);
    }
    // The new bubble is playing the dots out; bring the pill back only if
    // the bot is still working once that finishes.
    if (pill === 'hide' && typing) {
      const id = window.setTimeout(() => setPill('show'), typingLeaveMs());
      return () => window.clearTimeout(id);
    }
  }, [pill, typing, snap.born]);

  return {
    born: absorb ? textCount - 1 : snap.born,
    showTyping: pill === 'show' || pill === 'leave',
    leaving: pill === 'leave',
  };
}

type MessageMeta = {
  steps?: ToolStep[]; running?: boolean; agentStatus?: AgentStatus; model?: string;
  parts?: ReplyPart[]; reaction?: string; reactions?: Record<string, string>; reactable?: boolean;
  fromTyping?: number;
};

function UserMessage() {
  const meta = useAuiState((state) => state.message.metadata.custom) as MessageMeta;
  const bubble = useRef<HTMLDivElement>(null);
  const launch = useEmojiFlight();
  const [flying, setFlying] = useState<string | null>(null);
  // Equal to the reaction already on screen. A difference means this render
  // is the one where it arrived, so the chip stays hidden until the flight
  // (the effect below) has a DOM rect to leave from.
  const seen = useRef(meta.reaction);
  const pending = Boolean(meta.reaction && meta.reaction !== seen.current);
  useEffect(() => {
    const emoji = meta.reaction;
    const changed = emoji !== seen.current;
    seen.current = emoji;
    if (!changed || !emoji || !bubble.current) {
      if (!emoji) setFlying(null);
      return;
    }
    const box = bubble.current.getBoundingClientRect();
    const typing = document.querySelector('[data-typing]');
    const lift = typing?.closest('.chat-bubble-in') ?? typing;
    const from = lift?.getBoundingClientRect() ?? new DOMRect(box.left - 48, box.top, 36, 28);
    setFlying(flyEmoji(launch, emoji, from, reactionTarget(box, 'end'), lift) ? emoji : null);
  }, [meta.reaction, launch]);
  return (
    <MessagePrimitive.Root className={cn('mb-4 flex justify-end', meta.reaction && 'mb-7')}>
      <div ref={bubble} className="chat-bubble-in u-measure relative rounded-lg bg-ink px-3.5 py-2 text-[15px] leading-[1.55] text-bg">
        <MessagePrimitive.Parts />
        {meta.reaction ? (
          <ReactionChip key={meta.reaction} emoji={meta.reaction} align="end" landing={pending || flying === meta.reaction}
            label={t('reaction.bot', { emoji: meta.reaction })} />
        ) : null}
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  const meta = useAuiState((state) => state.message.metadata.custom) as MessageMeta;
  const id = useAuiState((state) => state.message.id);
  const content = useAuiState((state) => state.message.content);
  const retry = useContext(RetryContext);
  const react = useContext(ReactContext);

  // Plain text of the reply, for copying and for reading aloud. Taken from the
  // message itself rather than from the rendered DOM, so code blocks, tables
  // and image captions come out as the model wrote them.
  const text = useMemo(
    () => content.filter((part) => part.type === 'text').map((part) => part.text).join(''),
    [content],
  );

  const running = Boolean(meta.running);
  const steps = meta.steps ?? [];
  const parts = meta.parts ?? [];
  const last = parts[parts.length - 1];
  // Dots whenever the bot is working but not visibly typing the answer: before
  // anything arrives, after "one sec…", and between a finished tool and the
  // reply. A live tool already says what is happening.
  const typing = running && (!last || (last.type === 'text' ? Boolean(last.note)
    : !stepsFor(last.ids, steps).some((step) => step.status === 'active')));
  const textCount = parts.reduce((count, part) => count + (part.type === 'text' ? 1 : 0), 0);
  const motion = useBubbleMotion(typing, textCount);
  const lost = running && (meta.agentStatus === 'unavailable' || meta.agentStatus === 'disconnected');

  // "Thanks!" → 👍 and nothing else: the reaction sits on the user's bubble.
  // The pill stays one beat longer so its dots can shrink away instead of
  // the row vanishing between frames.
  if (!running && !parts.length && !motion.showTyping) return null;

  let bubble = -1;
  return (
    <MessagePrimitive.Root className="group/reply mb-6 flex gap-3">
      {/* Use the same static character as the header, aligned to the first line. */}
      <BotIcon className="mt-1.5" />
      {/* Область картинок — на всю репліку: тоді «наступна» в переглядачі
          доходить і до тих, що лежали в іншому абзаці відповіді. */}
      <GalleryScope>
        <div className="u-measure flex min-w-0 flex-1 flex-col items-start gap-1.5">
          {parts.map((part, index) => {
            if (part.type === 'steps') {
              return <ActivityLine key={`steps-${part.ids[0] ?? index}`} steps={stepsFor(part.ids, steps)} running={running} />;
            }
            bubble += 1;
            const at = bubble;
            return (
              <BotBubble
                key={`bubble-${at}`}
                text={part.text}
                note={part.note}
                running={running && index === parts.length - 1}
                reaction={meta.reactions?.[String(at)]}
                fromTyping={at === (motion.born >= 0 ? motion.born : meta.fromTyping)}
                onReact={!running && meta.reactable && react ? (emoji) => react(id, at, emoji) : undefined}
              />
            );
          })}
          {motion.showTyping ? <TypingBubble leaving={motion.leaving} /> : null}
          {lost ? (
            <p role="status" className="text-[12px] leading-relaxed text-warn">
              {activityT(meta.agentStatus === 'unavailable' ? 'activity.unavailable' : 'activity.disconnected')}
            </p>
          ) : null}
          {/* While the answer is still streaming its sources are half-found
              and its text is half-written — neither is worth acting on yet. */}
          {!running ? <SourceStrip steps={steps} /> : null}
          {!running && text ? (
            <MessageActions text={text} onRetry={retry?.id === id ? retry.run : undefined} />
          ) : null}
        </div>
      </GalleryScope>
    </MessagePrimitive.Root>
  );
}

export function Thread({
  compactedFrom,
  composer,
  retryId,
  onRetry,
  onReact,
}: {
  /** Скільки реплік сховано за переказом; 0 — розмову не стискали. */
  compactedFrom: number;
  /* Поле вводу приходить готовим: воно знає про моделі й контекст, а стрічка — ні. */
  composer: ReactNode;
  /** Id of the reply that may be retried, or '' while none may be. */
  retryId: string;
  onRetry: () => void;
  onReact: OnReact;
}) {
  const retry = useMemo(
    () => (retryId ? { id: retryId, run: onRetry } : null),
    [retryId, onRetry],
  );
  return (
    <EmojiFlights>
    <ReactContext value={onReact}>
    <RetryContext value={retry}>
    <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
      <ThreadPrimitive.Viewport className="relative flex min-h-0 flex-1 touch-pan-y flex-col overflow-y-auto overscroll-contain px-4 pt-5 sm:px-6">
        <div className="mx-auto flex w-full max-w-[760px] flex-1 flex-col">
          <ThreadPrimitive.Empty>
            <div className="flex flex-1 flex-col items-center justify-center gap-7 py-16 text-center">
              <div>
                <p className="u-label mb-2">{t('thread.new')}</p>
                {/* Питання друкується саме — порожній екран чату інакше
                    виглядає як екран, що не завантажився. */}
                <TextType
                  as="h2"
                  text={[t('thread.prompt1'), t('thread.prompt2'), t('thread.prompt3')]}
                  typingSpeed={55}
                  deletingSpeed={28}
                  pauseDuration={3200}
                  cursorCharacter="█"
                  className="text-[24px] font-semibold tracking-[-0.02em] text-ink"
                  cursorClassName="text-accent"
                />
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((key) => (
                  <ThreadPrimitive.Suggestion key={key} prompt={t(key)} method="replace" autoSend asChild>
                    <button
                      type="button"
                      className="rounded-full border border-line px-3.5 py-1.5 text-[13px] text-ink-2 transition-colors hover:border-accent hover:text-ink"
                    >
                      {glue(t(key))}
                    </button>
                  </ThreadPrimitive.Suggestion>
                ))}
              </div>
            </div>
          </ThreadPrimitive.Empty>

          {/* Переказ стиснутої розмови виглядає як звичайна відповідь бота,
              хоча бот такого не казав — це підсумок, зроблений на прохання.
              Без цього рядка виходила б підробка чужої репліки. */}
          {compactedFrom > 0 ? (
            <p className="u-label mb-4 flex items-center gap-2 text-ink-3">
              <span className="h-px flex-1 bg-line" />
              {t('thread.compacted', { count: compactedFrom })}
              <span className="h-px flex-1 bg-line" />
            </p>
          ) : null}

          <ThreadPrimitive.Messages
            components={{ UserMessage, AssistantMessage }}
          />

          <div className="h-8 shrink-0" />
        </div>
      </ThreadPrimitive.Viewport>

      <ThreadPrimitive.ScrollToBottom asChild>
        <Button
          variant="quiet"
          size="icon-sm"
          aria-label={t('thread.toLatestAria')}
          // At the bottom of the thread the primitive disables the button.
          // Hide it: a circle with nothing to do only distracts.
          className="chat-scroll-latest liquid-glass absolute bottom-[118px] left-1/2 z-10 size-9 -translate-x-1/2 rounded-full p-0 shadow-raise transition-opacity disabled:pointer-events-none disabled:opacity-0 max-[759px]:size-11"
        >
          <ArrowDown />
        </Button>
      </ThreadPrimitive.ScrollToBottom>

      {composer}
    </ThreadPrimitive.Root>
    </RetryContext>
    </ReactContext>
    </EmojiFlights>
  );
}
