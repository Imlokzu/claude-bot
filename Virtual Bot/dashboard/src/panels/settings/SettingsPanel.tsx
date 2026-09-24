import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AudioLines, Brain, Palette, Puzzle, Sparkles, User, Wrench } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Panel, PanelHead } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { SwitchRow } from '@/components/ui/Switch';
import { Segmented } from '@/components/ui/Segmented';
import { SkeletonList } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toaster';
import { get, post } from '@/lib/api';
import { cn } from '@/lib/cn';
import { glue } from '@/lib/glue';
import { t } from '@/lib/i18n';
import { ACCENTS, THEMES, useTheme } from '@/hooks/useTheme';
import { useLanguage } from '@/hooks/useLanguage';
import { JellyRadio } from '@/vendor/reactbits';
import { useCssVar } from '@/hooks/useAccentRgb';
import { StoreSection } from './StoreSection';
import { ToolsSection } from './ToolsSection';
import { FirstRun } from './FirstRun';
import { VoiceSection } from './VoiceSection';
import { SectionHeader } from '@/components/shell/SectionHeader';
import type { SetupData } from './types';

/*
 * Налаштування.
 *
 * Розділи — свій список ліворуч, а не гармошка й не майстер: сюди заходять,
 * щоб змінити ОДНУ річ, і майстер із кроками кожного разу змушував би йти
 * повз усе інше. Порядок від «хто це» до «чим воно живиться».
 */

const SECTIONS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: 'profile', label: 'Особистість', icon: User },
  { id: 'style', label: 'Стиль спілкування', icon: Sparkles },
  { id: 'look', label: 'Вигляд', icon: Palette },
  { id: 'voice', label: 'Голос', icon: AudioLines },
  { id: 'brain', label: 'Мозок і ключі', icon: Brain },
  { id: 'skills', label: 'Уміння', icon: Puzzle },
  { id: 'tools', label: 'Інструменти', icon: Wrench },
];

export default function SettingsPanel() {
  const toast = useToast();
  const client = useQueryClient();
  const [section, setSection] = useState('profile');
  // Майстер показуємо, доки профіль не позначено налаштованим; після
  // завершення він більше не зʼявляється, але його можна пройти знову,
  // якщо бекенд скине прапорець.
  const [wizardDone, setWizardDone] = useState(false);

  const setup = useQuery({ queryKey: ['setup'], queryFn: () => get<SetupData>('/api/setup') });

  const [form, setForm] = useState<SetupData['profile'] | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (setup.data) setForm(setup.data.profile);
  }, [setup.data]);

  const patch = <K extends keyof SetupData['profile']>(key: K, value: SetupData['profile'][K]) =>
    setForm((current) => (current ? { ...current, [key]: value } : current));

  const saveProfile = async () => {
    if (!form) return;
    setSaving(true);
    try {
      await post('/api/setup', { ...form, configured: true });
      toast.ok('Збережено');
      void client.invalidateQueries({ queryKey: ['setup'] });
    } catch (error) {
      toast.error('Не вдалося зберегти', (error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (setup.data && !setup.data.configured && !wizardDone) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <FirstRun setup={setup.data} onDone={() => setWizardDone(true)} />
      </div>
    );
  }

  const nav = (
    <nav className="flex shrink-0 gap-1 overflow-x-auto p-2 lg:w-[210px] lg:flex-col lg:overflow-visible lg:border-r lg:border-line">
      {SECTIONS.map((item) => {
        const active = item.id === section;
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => setSection(item.id)}
            className={cn(
              'flex h-9 shrink-0 items-center gap-2.5 rounded-md px-3 text-[13px] transition-colors',
              active ? 'bg-accent-soft text-ink' : 'text-ink-2 hover:bg-surface-2',
            )}
          >
            <Icon className="size-4" strokeWidth={1.75} style={active ? { color: 'var(--c-accent)' } : undefined} />
            <span className="whitespace-nowrap">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      {nav}

      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto w-full max-w-[640px] space-y-4">
          <SectionHeader className="mb-6" label="НАЛАШТУВАННЯ" title="Який бот і чим живиться" />
          {setup.isPending || !form ? (
            <Panel>
              <SkeletonList rows={6} />
            </Panel>
          ) : (
            <>
              {section === 'profile' ? (
                <Panel className="space-y-4">
                  <PanelHead label="особистість" hint={glue('Хто це і якою мовою говорить')} />
                  <Field label="Імʼя" htmlFor="bot-name">
                    <Input
                      id="bot-name"
                      value={form.name}
                      maxLength={60}
                      onChange={(event) => patch('name', event.target.value)}
                    />
                  </Field>

                  <Field label="Мова" htmlFor="bot-lang">
                    <Select
                      id="bot-lang"
                      value={form.language}
                      onChange={(event) => patch('language', event.target.value)}
                    >
                      {setup.data?.languages.map((item) => (
                        <option key={item.id} value={item.id}>{item.label}</option>
                      ))}
                    </Select>
                  </Field>

                  <Field label="Характер" hint={glue('Готовий пресет або свій опис нижче — свій має пріоритет.')}>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {setup.data?.personas.map((item) => {
                        const active = item.id === form.persona;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => patch('persona', item.id)}
                            className={cn(
                              'rounded-md border px-3 py-2.5 text-left transition-colors',
                              active
                                ? 'border-accent bg-accent-soft'
                                : 'border-line hover:border-line-strong hover:bg-surface-2',
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
                  </Field>

                  <Field label="Свій опис характеру" hint="напр. дотепний, трохи саркастичний, любить котів">
                    <Textarea
                      rows={2}
                      maxLength={400}
                      value={form.persona_custom}
                      onChange={(event) => patch('persona_custom', event.target.value)}
                    />
                  </Field>

                  <SaveBar saving={saving} onSave={saveProfile} />
                </Panel>
              ) : null}

              {section === 'style' ? (
                <Panel className="space-y-4">
                  <PanelHead label="стиль спілкування" hint={glue('Як бот відповідає')} />

                  <Field label="Довжина відповіді">
                    <Segmented
                      ariaLabel="Довжина відповіді"
                      value={form.reply_length}
                      onChange={(next) => patch('reply_length', next)}
                      items={(setup.data?.reply_lengths ?? []).map((item) => ({
                        value: item.id,
                        label: item.label,
                      }))}
                    />
                  </Field>

                  <div className="-mx-1">
                    <SwitchRow
                      label="Емодзі у відповідях"
                      checked={form.use_emoji}
                      onChange={(next) => patch('use_emoji', next)}
                    />
                    <SwitchRow
                      label="Спонтанні емоції"
                      hint={glue('Краб оживає сам, коли з ним довго не говорять')}
                      checked={form.spontaneous}
                      onChange={(next) => patch('spontaneous', next)}
                    />
                  </div>

                  <Field label="Привітання" hint="Порожньо — бот привітається сам">
                    <Input
                      value={form.greeting}
                      maxLength={300}
                      onChange={(event) => patch('greeting', event.target.value)}
                    />
                  </Field>

                  <SaveBar saving={saving} onSave={saveProfile} />
                </Panel>
              ) : null}

              {section === 'look' ? <LookSection /> : null}
              {section === 'voice' ? <VoiceSection /> : null}
              {section === 'brain' ? <BrainSection setup={setup.data!} /> : null}
              {section === 'skills' ? <StoreSection /> : null}
              {section === 'tools' ? <ToolsSection /> : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SaveBar({ saving, onSave }: { saving: boolean; onSave: () => void }) {
  return (
    <div className="flex justify-end border-t border-line pt-4">
      <Button variant="solid" disabled={saving} onClick={onSave}>
        {saving ? 'Зберігаю…' : 'Зберегти'}
      </Button>
    </div>
  );
}

/*
 * Вигляд зберігається ЛОКАЛЬНО (localStorage), а не на бекенді: це
 * налаштування цього екрана, а не бота. На телефоні й на столі людина
 * цілком може хотіти різні теми.
 */
function LookSection() {
  const { theme, accent, popup, setTheme, setAccent, setPopup } = useTheme();
  const [lang, setLang] = useLanguage();
  const accentColor = useCssVar('--c-accent', '#b95f3d');
  const accentInk = useCssVar('--c-accent-ink', '#fff');
  const surface2 = useCssVar('--c-surface-2', '#efe9df');
  const ink = useCssVar('--c-text', '#231e19');

  return (
    <Panel className="space-y-4">
      <PanelHead label="вигляд" hint={glue('Зберігається в цьому браузері')} />

      <Field label="Тема">
        <JellyRadio
          ariaLabel="Тема"
          value={theme}
          onChange={(next) => setTheme(next as typeof theme)}
          items={THEMES.map((item) => ({ value: item.id, label: item.label }))}
          radius={999}
          chipColor={surface2}
          activeColor={accentColor}
          textColor={ink}
          activeTextColor={accentInk}
        />
      </Field>

      <Field label={t('look.popups')}>
        <JellyRadio
          ariaLabel={t('look.popupsAria')}
          value={popup}
          onChange={(next) => setPopup(next as typeof popup)}
          items={[
            { value: 'solid', label: t('look.popupStandard') },
            { value: 'glass', label: t('look.popupGlass') },
          ]}
          radius={999}
          chipColor={surface2}
          activeColor={accentColor}
          textColor={ink}
          activeTextColor={accentInk}
        />
      </Field>

      <Field label="Мова">
        <JellyRadio
          ariaLabel="Мова"
          value={lang}
          onChange={(next) => setLang(next as typeof lang)}
          items={[
            { value: 'uk', label: 'Українська' },
            { value: 'en', label: 'English' },
          ]}
          radius={999}
          chipColor={surface2}
          activeColor={accentColor}
          textColor={ink}
          activeTextColor={accentInk}
        />
      </Field>

      <Field label="Акцент">
        <div className="flex gap-2">
          {ACCENTS.map((item) => {
            const active = item.id === accent;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setAccent(item.id)}
                aria-label={item.label}
                aria-pressed={active}
                title={item.label}
                className={cn(
                  'size-9 rounded-md border-2 transition-transform active:scale-95',
                  active ? 'border-ink' : 'border-transparent',
                )}
                style={{ background: item.swatch }}
              />
            );
          })}
        </div>
      </Field>
    </Panel>
  );
}

function BrainSection({ setup }: { setup: SetupData }) {
  const toast = useToast();
  const client = useQueryClient();
  const [model, setModel] = useState(setup.selected_model);
  const [omni, setOmni] = useState('');
  const [openclaw, setOpenclaw] = useState('');
  const [busy, setBusy] = useState(false);

  const saveKeys = async () => {
    setBusy(true);
    try {
      // Порожнє поле = «не міняти»: бекенд ігнорує порожні значення, тож
      // випадково стерти робочий ключ неможливо.
      await post('/api/setup/keys', { omni_key: omni, openclaw_token: openclaw });
      setOmni('');
      setOpenclaw('');
      toast.ok('Ключі збережено');
      void client.invalidateQueries({ queryKey: ['setup'] });
      void client.invalidateQueries({ queryKey: ['status'] });
    } catch (error) {
      toast.error('Не вдалося зберегти', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveModel = async (next: string) => {
    setModel(next);
    try {
      await post('/api/model', { model: next });
      void client.invalidateQueries({ queryKey: ['models'] });
      toast.ok('Модель змінено');
    } catch (error) {
      toast.error('Модель не прийнялась', (error as Error).message);
    }
  };

  return (
    <Panel className="space-y-4">
      <PanelHead label="мозок і ключі" hint={glue('Значення ключів назад не показуються')} />

      <Field label="Модель">
        <Select value={model} onChange={(event) => void saveModel(event.target.value)}>
          {setup.models.map((item) => (
            <option key={item.id} value={item.id}>{item.label || item.id}</option>
          ))}
        </Select>
      </Field>

      <Field
        label="Omni API-ключ"
        hint={setup.keys_set.omni ? 'Уже заданий — залиш порожнім, щоб не міняти' : 'Не заданий'}
      >
        <Input
          type="password"
          autoComplete="off"
          value={omni}
          onChange={(event) => setOmni(event.target.value)}
          placeholder={setup.keys_set.omni ? '••••••••' : 'вставити ключ'}
        />
      </Field>

      <Field
        label="OpenClaw токен"
        hint={setup.keys_set.openclaw ? 'Уже заданий — залиш порожнім, щоб не міняти' : 'Не заданий'}
      >
        <Input
          type="password"
          autoComplete="off"
          value={openclaw}
          onChange={(event) => setOpenclaw(event.target.value)}
          placeholder={setup.keys_set.openclaw ? '••••••••' : 'вставити токен'}
        />
      </Field>

      <div className="flex justify-end border-t border-line pt-4">
        <Button variant="solid" disabled={busy || (!omni && !openclaw)} onClick={saveKeys}>
          {busy ? 'Зберігаю…' : 'Зберегти ключі'}
        </Button>
      </div>
    </Panel>
  );
}
