import { useCallback } from 'react';
import { useToast } from '@/components/ui/Toaster';
import { useBrainModels, useSelectBrainModel, useSetThinking } from '@/lib/queries';
import { t } from '@/locales/chat';

/*
 * Which model answers, and how hard it thinks.
 *
 * Two places set these now: the model menu in the phone chat header and the
 * pickers inside the desktop prompt bar. Both must write the same OpenClaw
 * settings and say the same thing when they do, so the logic lives here
 * rather than being copied into each.
 */

/** Thinking levels exactly as OpenClaw knows them (agents.defaults.thinkingDefault). */
type EffortKey = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'adaptive' | 'max' | 'ultra';
const EFFORT_KEYS = new Set<string>(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive', 'max', 'ultra']);

export const thinkingLabel = (level: string): string =>
  EFFORT_KEYS.has(level) ? t(`effort.${level as EffortKey}`) : level;

export function useBrainChoice() {
  const brain = useBrainModels();
  const selectModel = useSelectBrainModel();
  const setThinking = useSetThinking();
  const toast = useToast();

  const models = brain.data?.models ?? [];
  // An empty `selected` means "keep the agent's default model" — show that
  // one, because that is the one that will answer.
  // While a change is in flight, show the requested value rather than the
  // old one: the config round-trip takes a moment, and a control that snaps
  // back on release reads as "it did not take".
  const current = (selectModel.isPending && selectModel.variables)
    || brain.data?.selected || brain.data?.default || '';
  const currentModel = models.find((model) => model.id === current);

  const pickModel = useCallback(
    (id: string) => {
      if (!id || id === current) return;
      selectModel.mutate(id, {
        onError: (error) => toast.error(t('composer.modelFailed'), (error as Error).message),
      });
    },
    [current, selectModel, toast],
  );

  /*
   * The thinking level is an OpenClaw SETTING, not a property of one reply:
   * its HTTP endpoint has no reasoning field, so the level goes into the
   * config and applies to every conversation from then on. The toast says
   * so out loud. An empty level clears the setting, which is a different
   * state from "off" — the built-in default applies, and the CLI does not
   * name it.
   */
  const thinking = setThinking.isPending ? (setThinking.variables ?? '') : brain.data?.thinking || '';
  const pickThinking = useCallback(
    (level: string) => {
      if (level === thinking) return;
      const label = level ? thinkingLabel(level) : t('composer.asConfigured');
      setThinking.mutate(level, {
        onSuccess: () =>
          toast.toast(t('composer.effortToast', { level: label }), {
            description: level ? t('composer.effortSaved') : t('composer.effortCleared'),
          }),
        onError: (error) => toast.error(t('composer.effortFailed'), (error as Error).message),
      });
    },
    [thinking, setThinking, toast],
  );

  return {
    loading: brain.isPending && !brain.data,
    models,
    current,
    currentModel,
    contextSize: currentModel?.context ?? 0,
    pickModel,
    levels: brain.data?.thinking_levels ?? [],
    thinking,
    pickThinking,
  };
}
