import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { JellyRadio, SpringCheck, Step, Stepper } from '@/vendor/reactbits';
import { useCssVar } from '@/hooks/useAccentRgb';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { useToast } from '@/components/ui/Toaster';
import { ACCENTS, THEMES, useTheme } from '@/hooks/useTheme';
import { post } from '@/lib/api';
import { cn } from '@/lib/cn';
import { glue } from '@/lib/glue';
import type { SetupData } from './types';

/*
 * Перший запуск.
 *
 * Стара панель відкривала майстер сама, коли профіль ще не налаштовано, і це
 * було правильно: у чистого бота немає ні імені, ні мови, ні ключів, і
 * порожній чат нічого про це не каже. Тут те саме, але кроками
 * (React Bits · Stepper) — видно, скільки лишилось, і можна повернутись.
 *
 * Ключі свідомо НЕ питаємо: без них бот усе одно відповість локальним
 * мозком, а форма з двома паролями на першому екрані відлякує. Вони чекають
 * у «Мозок і ключі».
 */
export function FirstRun({ setup, onDone }: { setup: SetupData; onDone: () => void }) {
  const toast = useToast();
  const client = useQueryClient();
  const { theme, accent, setTheme, setAccent } = useTheme();
  const [form, setForm] = useState(setup.profile);

  const accentColor = useCssVar('--c-accent', '#b95f3d');
  const accentInk = useCssVar('--c-accent-ink', '#fff');
  const surface2 = useCssVar('--c-surface-2', '#efe9df');
  const ink = useCssVar('--c-text', '#231e19');

  const patch = <K extends keyof SetupData['profile']>(key: K, value: SetupData['profile'][K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const finish = async () => {
    try {
      await post('/api/setup', { ...form, configured: true });
      void client.invalidateQueries({ queryKey: ['setup'] });
      toast.ok('Готово', `${form.name} налаштований`);
      onDone();
    } catch (error) {
      toast.error('Не вдалося зберегти', (error as Error).message);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[560px]">
      <div className="mb-5 text-center">
        <p className="u-label mb-2">перший запуск</p>
        <h1 className="text-[24px] font-semibold tracking-[-0.025em] text-ink">
          {glue('Познайомимось')}
        </h1>
        <p className="u-measure mx-auto mt-1.5 text-[13px] text-ink-3">
          {glue('Чотири кроки. Усе це потім можна змінити в налаштуваннях.')}
        </p>
      </div>

      <Stepper
        initialStep={1}
        backButtonText="Назад"
        nextButtonText="Далі"
        onFinalStepCompleted={() => void finish()}
        stepCircleContainerClassName="!bg-surface !border-line !rounded-lg"
        contentClassName="!px-1"
        footerClassName="!px-1"
      >
        <Step>
          <div className="space-y-4 py-2">
            <Field label="Як його звати?" htmlFor="fr-name">
              <Input
                id="fr-name"
                autoFocus
                value={form.name}
                maxLength={60}
                onChange={(event) => patch('name', event.target.value)}
              />
            </Field>
            <Field label="Мова">
              <Segmented
                ariaLabel="Мова"
                value={form.language}
                onChange={(next) => patch('language', next)}
                items={setup.languages.map((item) => ({ value: item.id, label: item.label }))}
              />
            </Field>
          </div>
        </Step>

        <Step>
          <div className="py-2">
            <p className="mb-3 text-[13px] text-ink-2">{glue('Який у нього характер?')}</p>
            <div className="grid grid-cols-2 gap-2">
              {setup.personas.map((item) => {
                const active = item.id === form.persona;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => patch('persona', item.id)}
                    className={cn(
                      'rounded-md border px-3 py-2.5 text-left transition-colors',
                      active ? 'border-accent bg-accent-soft' : 'border-line hover:border-line-strong',
                    )}
                  >
                    <span className="block text-[13px] text-ink">{item.label}</span>
                    {item.hint ? (
                      <span className="mt-0.5 block text-[11px] leading-snug text-ink-3">{item.hint}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            <Field label="Або опиши своїми словами" className="mt-4">
              <Textarea
                rows={2}
                maxLength={400}
                value={form.persona_custom}
                onChange={(event) => patch('persona_custom', event.target.value)}
                placeholder="напр. дотепний, трохи саркастичний, любить котів"
              />
            </Field>
          </div>
        </Step>

        <Step>
          <div className="space-y-4 py-2">
            <Field label="Довжина відповідей">
              <Segmented
                ariaLabel="Довжина відповіді"
                value={form.reply_length}
                onChange={(next) => patch('reply_length', next)}
                items={setup.reply_lengths.map((item) => ({ value: item.id, label: item.label }))}
              />
            </Field>
            {/* У майстрі це радше чеклист, ніж налаштування, тож і вигляд
                чеклиста: позначив — рядок закреслився й пішов далі. */}
            <div className="space-y-2.5 pt-1">
              <SpringCheck
                label="Емодзі у відповідях"
                checked={form.use_emoji}
                onChange={(next) => patch('use_emoji', next)}
                boxSize={24}
                fontSize={15}
                color={ink}
                fillColor={accentColor}
                checkColor={accentInk}
              />
              <SpringCheck
                label="Спонтанні емоції, коли з ним не говорять"
                checked={form.spontaneous}
                onChange={(next) => patch('spontaneous', next)}
                boxSize={24}
                fontSize={15}
                color={ink}
                fillColor={accentColor}
                checkColor={accentInk}
              />
            </div>
          </div>
        </Step>

        <Step>
          <div className="space-y-4 py-2">
            <Field label="Тема панелі">
              <JellyRadio
                ariaLabel="Тема"
                value={theme}
                onChange={(next) => setTheme(next as typeof theme)}
                items={THEMES.map((item) => ({ value: item.id, label: item.label }))}
                size="sm"
                radius={999}
                chipColor={surface2}
                activeColor={accentColor}
                textColor={ink}
                activeTextColor={accentInk}
              />
            </Field>
            <Field label="Акцент" hint="Краб теж перефарбується">
              <div className="flex gap-2">
                {ACCENTS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setAccent(item.id)}
                    aria-label={item.label}
                    aria-pressed={item.id === accent}
                    className={cn(
                      'size-9 rounded-md border-2 transition-transform active:scale-95',
                      item.id === accent ? 'border-ink' : 'border-transparent',
                    )}
                    style={{ background: item.swatch }}
                  />
                ))}
              </div>
            </Field>
          </div>
        </Step>
      </Stepper>
    </div>
  );
}
