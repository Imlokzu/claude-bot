import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { MessagePrimitive, ThreadPrimitive, useAuiState } from '@assistant-ui/react';
import { ArrowDown } from 'lucide-react';
import { GalleryScope } from './Gallery';
import { cn } from '@/lib/cn';
import { TextType } from '@/vendor/reactbits';
import { ActivityLine, BotBubble, ReactionChip, TypingBubble } from './Bubbles';
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

type MessageMeta = {
  steps?: ToolStep[]; running?: boolean; agentStatus?: AgentStatus; model?: string;
  parts?: ReplyPart[]; reaction?: string; reactions?: Record<string, string>; reactable?: boolean;
};

function UserMessage() {
  const meta = useAuiState((state) => state.message.metadata.custom) as MessageMeta;
  return (
    <MessagePrimitive.Root className={cn('mb-4 flex justify-end', meta.reaction && 'mb-7')}>
      <div className="chat-bubble-in u-measure relative rounded-lg bg-ink px-3.5 py-2 text-[15px] leading-[1.55] text-bg">
        <MessagePrimitive.Parts />
        {meta.reaction ? (
          <ReactionChip emoji={meta.reaction} align="end" label={t('reaction.bot', { emoji: meta.reaction })} />
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
  const lost = running && (meta.agentStatus === 'unavailable' || meta.agentStatus === 'disconnected');

  // "Thanks!" → 👍 and nothing else: the reaction sits on the user's bubble.
  if (!running && !parts.length) return null;

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
                onReact={!running && meta.reactable && react ? (emoji) => react(id, at, emoji) : undefined}
              />
            );
          })}
          {typing ? <TypingBubble /> : null}
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

          <div className="h-4 shrink-0" />
        </div>
      </ThreadPrimitive.Viewport>

      <ThreadPrimitive.ScrollToBottom asChild>
        <Button
          variant="quiet"
          size="sm"
          aria-label={t('thread.toLatestAria')}
          // Внизу стрічки примітив вимикає кнопку — ховаємо її, а не лишаємо
          // блідою: кружечок без діла посеред розмови тільки відволікає.
          className="chat-scroll-latest absolute bottom-[118px] left-1/2 z-10 -translate-x-1/2 rounded-full border border-line bg-surface/95 shadow-raise backdrop-blur transition-opacity disabled:pointer-events-none disabled:opacity-0"
        >
          <ArrowDown />
          <span>{t('thread.toLatest')}</span>
        </Button>
      </ThreadPrimitive.ScrollToBottom>

      {composer}
    </ThreadPrimitive.Root>
    </RetryContext>
    </ReactContext>
  );
}
