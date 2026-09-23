import { useCallback, useMemo, useRef, useState } from 'react';
import { Brain, Eye, FileText, Globe, LifeBuoy, Paperclip, Plus, Zap } from 'lucide-react';
import VoiceBeam from 'voice-glow';
import { PromptBar, type PromptBarControl } from '@/vendor/reactbits';
import { useToast } from '@/components/ui/Toaster';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { post } from '@/lib/api';
import type { BrainModel } from '@/lib/queries';
import { useCssVar } from '@/hooks/useAccentRgb';
import { useDictation } from '@/hooks/useDictation';
import { ToolsSection } from '@/panels/settings/ToolsSection';
import { ContextMeter } from './ContextMeter';
import { AttachSheet } from './AttachSheet';
import { thinkingLabel, useBrainChoice } from './useBrainChoice';
import { t } from '@/locales/chat';
import { t as appT } from '@/lib/i18n';

/*
 * The input is React Bits' PromptBar (reactbits.dev/c/micro), as is.
 *
 * A home-made version of this row existed once and repeated it worse. We only
 * connect it to the backend and add what it lacks: the context meter, and on
 * narrow screens our own "+" sheet.
 *
 * THE MAIN THING about the model list. It used to be the Omni list from
 * config.yaml — and choosing from it CHANGED NOTHING: OpenClaw answers the
 * chat with its own model, so the screen could say "MiniMax M3" while
 * gpt-oss-120b was actually writing. The list now comes from OpenClaw itself
 * (`openclaw models list`) and the choice travels as `x-openclaw-model` — it
 * picks what it shows.
 *
 * Two layouts:
 *
 *   desk — the pickers live inside the bar and the meter sits under it;
 *          there is width for all of it.
 *   lean — phone and tablet. Model and thinking move to the chat header
 *          (ModelMenu), the meter and tools move into the "+" sheet, and the
 *          bar keeps only what you type with. On a phone the two pickers
 *          squeezed the field down to a few words.
 */

/*
 * Model traits as icons, not text.
 *
 * The OpenClaw catalog names them in the label itself: "GLM-5.3 Flash (sees
 * images, ~2.5 s)". In the composer row that label was cut off right at the
 * useful part, so the backend splits the tail into traits (see
 * openclaw_models._normalize) and here they become two icons.
 *
 * Beside the name only the two that matter for choosing right now: will it
 * see an attached picture, and will it answer quickly. Which one is default
 * and which is the fallback shows only in the open list: in the row it is
 * noise.
 */
const TRAITS = [
  { key: 'vision', Icon: Eye, title: () => t('trait.vision') },
  {
    key: 'fast',
    Icon: Zap,
    title: (model: BrainModel) =>
      model.seconds ? t('trait.fastSeconds', { seconds: model.seconds }) : t('trait.fast'),
  },
] as const;

/** Second-row icons: the model's role in the OpenClaw chain. */
const ROLES = [
  { key: 'is_default', Icon: Brain, title: t('role.default') },
  { key: 'fallback', Icon: LifeBuoy, title: t('role.fallback') },
] as const;

export function Composer({
  busy,
  usedTokens,
  sessionId,
  onSend,
  onStop,
  onCompacted,
  lean = false,
  onOpenPanels,
}: {
  busy: boolean;
  usedTokens: number;
  sessionId: string;
  onSend: (text: string, attachments?: unknown[]) => void;
  onStop: () => void;
  onCompacted: () => void;
  /** Phone/tablet layout — see the header. */
  lean?: boolean;
  /** Opens the pinned panels; on narrow screens the sheet is the way in. */
  onOpenPanels?: () => void;
}) {
  const brain = useBrainChoice();
  const dictation = useDictation();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const bar = useRef<PromptBarControl | null>(null);
  const plus = useRef<HTMLButtonElement>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const closeSheet = useCallback(() => setSheetOpen(false), []);

  const uploadFiles = async (files: FileList | File[]): Promise<unknown[]> => {
    const uploaded = [];
    for (const file of Array.from(files).slice(0, 8)) {
      const body = new FormData();
      body.append('file', file);
      try {
        uploaded.push(await post<{ url: string; name: string; type: string; size: number }>(
          '/api/chat/upload', body,
        ));
      } catch (error) {
        toast.error(t('composer.uploadFailed'), (error as Error).message);
      }
    }
    return uploaded;
  };

  const surface = useCssVar('--c-surface', '#fffdf8');
  const surface3 = useCssVar('--c-surface-3', '#e5ddd0');
  const ink = useCssVar('--c-text', '#231e19');
  const accent = useCssVar('--c-accent', '#b95f3d');

  const modelList = useMemo(
    () =>
      brain.models.map((model) => ({
        key: model.id,
        // The name as a node, not a string: PromptBar draws it both in the
        // collapsed row and in the list, and the icons belong in both.
        name: (
          <span className="inline-flex items-center gap-1.5">
            {model.label}
            {TRAITS.filter(({ key }) => Boolean(model[key])).map(({ key, Icon, title }) => (
              <Icon key={key} className="size-3.5 opacity-75">
                <title>{title(model)}</title>
              </Icon>
            ))}
          </span>
        ),
        tag: (
          <>
            {ROLES.filter(({ key }) => Boolean(model[key])).map(({ key, Icon, title }) => (
              <Icon key={key} className="size-3.5">
                <title>{title}</title>
              </Icon>
            ))}
          </>
        ),
      })),
    [brain.models],
  );

  const pickerModels = brain.models.length > 0 ? modelList : [{
    key: '__openclaw-loading__',
    name: <span className="text-ink-3">OpenClaw</span>,
    tag: <span className="text-[10px] text-ink-3">{t('composer.loading')}</span>,
  }];

  /*
   * Levels come from the backend, not from our own idea of them: OpenClaw's
   * HTTP gateway has no reasoning field at all, and the only live lever is
   * its config, which knows exactly this list.
   *
   * The first stop is "as in OpenClaw": the level may be UNSET, and then a
   * built-in default applies that the CLI does not name. Showing "off" there
   * would name an unknown as a known — they are different states, and there
   * would be no way back from "off" to "unset".
   */
  const AS_CONFIGURED = t('composer.asConfigured');
  const efforts = useMemo(
    () => [AS_CONFIGURED, ...brain.levels.map((level) => thinkingLabel(level))],
    [AS_CONFIGURED, brain.levels],
  );
  const effortByLabel = useMemo<Record<string, string>>(
    () => ({
      [AS_CONFIGURED]: '',
      ...Object.fromEntries(brain.levels.map((level) => [thinkingLabel(level), level])),
    }),
    [AS_CONFIGURED, brain.levels],
  );

  const context = {
    sessionId,
    contextSize: brain.contextSize,
    usedTokens,
    onCompacted,
  };

  /*
   * The model catalog may run the OpenClaw CLI and take a few seconds to
   * answer. The input must not hide because of that: show a stable fallback
   * and let the picker switch to the real list once the catalog answers.
   *
   * PromptBar reads `defaultModel` ONLY on mount. Mounted before the backend
   * answers, it would settle on an empty key and show the first model of the
   * list forever — again not the one answering. The catalog is cached for two
   * minutes, so this placeholder is visible once.
   */
  return (
    <div className="chat-composer u-safe-b shrink-0 px-4 pb-3 pt-2 sm:px-6">
      <div className="mx-auto flex w-full max-w-[760px] flex-col items-stretch gap-1.5">
        {lean ? (
          <AttachSheet
            open={sheetOpen}
            onClose={closeSheet}
            anchor={plus}
            onFiles={(files) => void uploadFiles(files).then((uploaded) => bar.current?.addAttachments(uploaded))}
            onTools={() => {
              setSheetOpen(false);
              setToolsOpen(true);
            }}
            onPanels={() => {
              setSheetOpen(false);
              onOpenPanels?.();
            }}
            context={context}
          />
        ) : null}

        {/*
          The glow is laid OVER the field, not wrapped around it.

          voice-glow gives its wrapper `overflow: hidden` to clip the glow to
          the field's rounding. While the field sat inside it, its menus fell
          under the same knife: the model list, the thinking level, the "+" —
          everything that opens upwards was cut exactly at the row's edge and
          the popups seemed stuck. Now the wrapper sits on top as an empty
          frame of the same size: same glow, and the menus are no longer its
          children.
        */}
        <div className="relative">
          <PromptBar
            placeholder={t('composer.placeholder')}
            labels={{
              effort: t('composer.effort'),
              effortHint: t('composer.effortHint'),
              faster: t('composer.faster'),
              smarter: t('composer.smarter'),
              sources: t('composer.sources'),
              commands: t('composer.commands'),
              models: t('composer.models'),
              chooseModel: t('composer.chooseModel'),
              chooseEffort: t('composer.chooseEffort'),
              prompt: t('composer.prompt'),
              add: t('composer.add'),
              listening: t('composer.listening'),
              dictate: t('composer.dictate'),
              stopDictation: t('composer.stopDictation'),
              send: t('composer.send'),
              stop: t('composer.stop'),
            }}
            width="100%"
            radius={16}
            maxRows={8}
            busy={busy}
            background={surface}
            color={ink}
            menuBackground={surface3}
            sparkColor={accent}
            controlRef={bar}
            // Empty lists hide the pickers: in the lean layout they live in
            // the chat header instead.
            models={lean ? [] : pickerModels}
            efforts={lean ? [] : efforts}
            plusSlot={lean ? (
              <button
                ref={plus}
                type="button"
                className="prompt-bar__tool"
                aria-label={t('composer.add')}
                aria-expanded={sheetOpen}
                data-on={sheetOpen ? '' : undefined}
                onClick={() => setSheetOpen((value) => !value)}
              >
                <Plus
                  className="size-4 transition-transform duration-200 motion-reduce:transition-none"
                  style={{ transform: sheetOpen ? 'rotate(45deg)' : undefined }}
                />
              </button>
            ) : undefined}
            sources={[
              { key: 'files', name: t('composer.srcFiles'), description: t('composer.srcFilesDesc'), icon: Paperclip, attach: true },
              { key: 'web', name: t('composer.srcWeb'), description: t('composer.srcWebDesc'), icon: Globe },
              { key: 'memory', name: t('composer.srcMemory'), description: t('composer.srcMemoryDesc'), icon: FileText },
            ]}
            defaultModel={brain.current || '__openclaw-loading__'}
            defaultEffort={brain.thinking ? thinkingLabel(brain.thinking) : AS_CONFIGURED}
            onEffortChange={(label) => {
              const level = effortByLabel[label];
              if (level !== undefined) brain.pickThinking(level);
            }}
            onModelChange={(key) => {
              if (key !== '__openclaw-loading__') brain.pickModel(key);
            }}
            onAttach={() => new Promise((resolve) => {
              const input = fileInput.current;
              if (!input) return resolve([]);
              input.onchange = async () => {
                resolve(await uploadFiles(input.files ?? []));
                input.value = '';
              };
              input.click();
            })}
            commands={[
              { key: 'memory', name: t('composer.cmdMemory'), description: t('composer.cmdMemoryDesc') },
              { key: 'files', name: t('composer.cmdFiles'), description: t('composer.cmdFilesDesc') },
              { key: 'status', name: t('composer.cmdStatus'), description: t('composer.cmdStatusDesc') },
            ]}
            onSend={(text, meta) => {
              setSheetOpen(false);
              onSend(text, meta.attachments);
            }}
            onStop={onStop}
            /*
             * Dictation stops on its own, on silence: PromptBar has no "stop",
             * only a cancel of the wait, and text recognised after a second
             * press would simply vanish (see useDictation). A second press of
             * the mic now closes the phrase and sends it for recognition right
             * away instead of waiting for silence; the mic is released too —
             * there is nothing to keep it open for after "I'm done".
             */
            onDictateStop={dictation.finish}
            onDictate={async () => {
              const text = await dictation.listen();
              if (!text && dictation.error) toast.error(t('composer.dictation'), dictation.error);
              return text;
            }}
          />

          <input
            ref={fileInput}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp,image/gif,.txt,.md,.json,.pdf"
            className="hidden"
            tabIndex={-1}
            aria-hidden="true"
          />

          <div className="pointer-events-none absolute inset-0">
            <VoiceBeam
              stream={dictation.stream}
              type="default"
              colorVariant="sunset"
              /*
               * While the mic is not listening there is NO glow at all:
               * `active` switches the effect off and `idle=0` removes the
               * breathing in silence. The default breathing would glow under
               * the field all the time and turn a recording indicator into a
               * decoration.
               */
              active={Boolean(dictation.stream)}
              idle={0}
              // The radius comes from the field: the child here is empty and
              // the component has nothing to derive it from.
              borderRadius={16}
            >
              <div className="size-full" />
            </VoiceBeam>
          </div>
        </div>

        {/*
          The draft while the phrase is still going. Without it dictation
          looks like an empty wait: the mic is lit and nothing is on screen,
          and it is unclear whether you are heard at all. The full model will
          still produce the final text and put it in the field.
        */}
        {dictation.recognizing ? (
          <p className="self-center text-[12px] italic text-ink-3">{t('composer.recognizing')}</p>
        ) : dictation.partial ? (
          <p className="self-center text-[12px] italic text-ink-3">{t('composer.hearing', { text: dictation.partial })}</p>
        ) : null}

        {/* Context headroom. PromptBar does not know about it, but you need
            to: it is what explains why a long conversation starts to
            "forget". In the lean layout it lives in the sheet. */}
        {!lean ? (
          <div className="self-center">
            <ContextMeter {...context} />
          </div>
        ) : null}
      </div>

      {lean ? (
        <Dialog open={toolsOpen} onOpenChange={setToolsOpen}>
          <DialogContent title={appT('tools.title')} side="bottom" className="h-[min(80dvh,720px)]">
            <ToolsSection />
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
