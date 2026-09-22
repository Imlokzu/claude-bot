import { MessagePrimitive, ThreadPrimitive, useAuiState } from '@assistant-ui/react';
import { ArrowDown } from 'lucide-react';
import { Markdown } from './Markdown';
import { GalleryScope } from './Gallery';
import { TextType } from '@/vendor/reactbits';
import { Thinking } from './Thinking';
import { Button } from '@/components/ui/Button';
import { BotIcon } from '@/components/ui/BotIcon';
import { glue } from '@/lib/glue';
import { t } from '@/locales/chat';
import type { ToolStep } from './types';
import type { AgentStatus } from '@/lib/chatStream';

/*
 * Стрічка розмови.
 *
 * Репліка людини — плашка праворуч: коротка, її треба лише впізнати.
 * Відповідь бота — без плашки, на всю міру рядка: її читають, і рамка навколо
 * абзацу заважає (DESIGN.md, правило 5).
 */

const SUGGESTIONS = ['thread.suggestion1', 'thread.suggestion2', 'thread.suggestion3'] as const;

function UserMessage() {
  return (
    <MessagePrimitive.Root className="mb-5 flex justify-end">
      <div className="u-measure rounded-lg rounded-br-xs bg-accent-soft px-3.5 py-2.5 text-[15px] leading-[1.55] text-ink">
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  const activity = useAuiState((state) => state.message.metadata.custom) as {
    steps?: ToolStep[]; running?: boolean; agentStatus?: AgentStatus; model?: string;
  };
  return (
    <MessagePrimitive.Root className="mb-6 flex gap-3">
      {/* Use the same static character as the header, aligned to the first line. */}
      <BotIcon className="mt-1" />
      {/* Область картинок — на всю репліку: тоді «наступна» в переглядачі
          доходить і до тих, що лежали в іншому абзаці відповіді. */}
      <GalleryScope>
        <div className="u-measure min-w-0 flex-1">
          {activity.running || activity.steps?.length ? <Thinking steps={activity.steps ?? []}
            running={Boolean(activity.running)} status={activity.agentStatus} model={activity.model} /> : null}
          <MessagePrimitive.Parts components={{ Text: Markdown }} />
        </div>
      </GalleryScope>
    </MessagePrimitive.Root>
  );
}

export function Thread({
  compactedFrom,
  composer,
}: {
  /** Скільки реплік сховано за переказом; 0 — розмову не стискали. */
  compactedFrom: number;
  /* Поле вводу приходить готовим: воно знає про моделі й контекст, а стрічка — ні. */
  composer: React.ReactNode;
}) {
  return (
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
  );
}
