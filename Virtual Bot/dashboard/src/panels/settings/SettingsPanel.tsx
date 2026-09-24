import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AudioLines, Brain, Palette, Puzzle, Search, Sparkles, User, Wrench } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Field';
import { Switch } from '@/components/ui/Switch';
import { Segmented } from '@/components/ui/Segmented';
import { SkeletonList } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toaster';
import { get, post } from '@/lib/api';
import { cn } from '@/lib/cn';
import { glue } from '@/lib/glue';
import { t as lookT } from '@/lib/i18n';
import { t } from '@/locales/settings';
import { ACCENTS, THEMES, useTheme } from '@/hooks/useTheme';
import { useLanguage } from '@/hooks/useLanguage';
import { JellyRadio } from '@/vendor/reactbits';
import { useCssVar } from '@/hooks/useAccentRgb';
import { StoreSection } from './StoreSection';
import { ToolsSection } from './ToolsSection';
import { FirstRun } from './FirstRun';
import { VoiceSection } from './VoiceSection';
import { fieldMatches, OpenClawFields, useOpenClawSettings } from './OpenClawSection';
import { SettingGroup, SettingRow } from './SettingRow';
import type { SetupData } from './types';

/*
 * Settings are tabs. Each tab is a few categories, and a category mixes
 * panel fields with OpenClaw fields. There is no OpenClaw tab: a gateway
 * row is marked and sits next to the local row it belongs with.
 */

type SectionId = 'profile' | 'style' | 'brain' | 'voice' | 'look' | 'tools' | 'skills';

const SECTIONS: { id: SectionId; label: 'settings.section.profile' | 'settings.section.style' | 'settings.section.brain' | 'settings.section.voice' | 'settings.section.look' | 'settings.section.tools' | 'settings.section.skills'; icon: LucideIcon; local: string }[] = [
  { id: 'profile', label: 'settings.section.profile', icon: User, local: 'імʼя мова характер опис name persona' },
  { id: 'style', label: 'settings.section.style', icon: Sparkles, local: 'емодзі привітання довжина спонтанні emoji greeting reply' },
  { id: 'brain', label: 'settings.section.brain', icon: Brain, local: 'модель ключ omni токен model key' },
  { id: 'voice', label: 'settings.section.voice', icon: AudioLines, local: 'голос мікрофон темп voice' },
  { id: 'look', label: 'settings.section.look', icon: Palette, local: 'тема попап скло акцент theme popup glass accent' },
  { id: 'tools', label: 'settings.section.tools', icon: Wrench, local: 'інструмент дозвіл tool' },
  { id: 'skills', label: 'settings.section.skills', icon: Puzzle, local: 'уміння скіл skill' },
];

const fieldControl = 'h-8 w-[200px] text-[13px]';

export default function SettingsPanel() {
  const toast = useToast();
  const client = useQueryClient();
  const [section, setSection] = useState<SectionId>('profile');
  const [query, setQuery] = useState('');
  const openclaw = useOpenClawSettings();
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

  const needle = query.trim().toLowerCase();
  const gatewayFields = openclaw.data?.fields ?? [];
  const visible = SECTIONS.filter((item) => {
    if (!needle) return true;
    if (t(item.label).toLowerCase().includes(needle)) return true;
    if (item.local.includes(needle)) return true;
    return gatewayFields.some((field) => field.section === item.id && fieldMatches(field, needle));
  });
  const current = visible.find((item) => item.id === section) ?? visible[0];
  const narrowed = (id: SectionId) => {
    if (!needle) return false;
    const item = SECTIONS.find((entry) => entry.id === id);
    if (!item) return false;
    return !t(item.label).toLowerCase().includes(needle) && !item.local.includes(needle);
  };

  const nav = (
    <div className="flex shrink-0 flex-col border-b border-line lg:w-[232px] lg:border-b-0 lg:border-r">
      <div className="p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('settings.search')}
            aria-label={t('settings.search')}
            className="h-8 w-full rounded-md border border-line bg-surface-2 pl-8 pr-2 text-[13px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
          />
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto px-2 pb-2 lg:flex-col lg:overflow-visible lg:px-2 lg:pb-3">
        {visible.map((item) => {
          const active = item.id === current?.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setSection(item.id)}
              className={cn(
                'flex h-8 shrink-0 items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors',
                active ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:bg-surface-2',
              )}
            >
              <Icon className="size-4" strokeWidth={1.75} />
              <span className="whitespace-nowrap">{t(item.label)}</span>
            </button>
          );
        })}
        {visible.length === 0 ? (
          <p className="px-2.5 py-2 text-[12px] text-ink-3">{t('settings.empty')}</p>
        ) : null}
      </nav>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      {nav}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8">
        <div className="mx-auto w-full max-w-[720px]">
          {current ? (
            <h1 className="mb-5 text-[22px] font-medium tracking-[-0.02em] text-ink">{t(current.label)}</h1>
          ) : null}
          {setup.isPending || !form ? (
            <SettingGroup>
              <div className="p-4"><SkeletonList rows={6} /></div>
            </SettingGroup>
          ) : (
            <>
              {current?.id === 'profile' ? (
                <SettingGroup label={t('settings.group.identity')}>
                  <SettingRow label="Імʼя" htmlFor="bot-name">
                    <Input
                      id="bot-name"
                      className={fieldControl}
                      value={form.name}
                      maxLength={60}
                      onChange={(event) => patch('name', event.target.value)}
                    />
                  </SettingRow>
                  <SettingRow label="Мова" htmlFor="bot-lang">
                    <Select
                      id="bot-lang"
                      className={fieldControl}
                      value={form.language}
                      onChange={(event) => patch('language', event.target.value)}
                    >
                      {setup.data?.languages.map((item) => (
                        <option key={item.id} value={item.id}>{item.label}</option>
                      ))}
                    </Select>
                  </SettingRow>
                  <div className="border-b border-line px-4 py-3">
                    <p className="text-[13px] text-ink">Характер</p>
                    <p className="mt-0.5 text-[12px] leading-snug text-ink-3">
                      {glue('Готовий пресет або свій опис нижче — свій має пріоритет.')}
                    </p>
                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
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
                  </div>
                  <SettingRow label="Свій опис" hint="напр. дотепний, трохи саркастичний, любить котів">
                    <Textarea
                      rows={2}
                      className="w-[240px] text-[13px]"
                      maxLength={400}
                      value={form.persona_custom}
                      onChange={(event) => patch('persona_custom', event.target.value)}
                    />
                  </SettingRow>
                  <SaveBar saving={saving} onSave={saveProfile} />
                </SettingGroup>
              ) : null}

              {current?.id === 'style' ? (
                <div className="space-y-6">
                {narrowed('style') ? null : (
                <SettingGroup label={t('settings.group.talk')}>
                  <SettingRow label="Довжина відповіді">
                    <Segmented
                      ariaLabel="Довжина відповіді"
                      value={form.reply_length}
                      onChange={(next) => patch('reply_length', next)}
                      items={(setup.data?.reply_lengths ?? []).map((item) => ({
                        value: item.id,
                        label: item.label,
                      }))}
                    />
                  </SettingRow>
                  <SettingRow label="Емодзі у відповідях">
                    <Switch checked={form.use_emoji} onChange={(next) => patch('use_emoji', next)} label="Емодзі у відповідях" />
                  </SettingRow>
                  <SettingRow label="Спонтанні емоції" hint={glue('Краб оживає сам, коли з ним довго не говорять')}>
                    <Switch checked={form.spontaneous} onChange={(next) => patch('spontaneous', next)} label="Спонтанні емоції" />
                  </SettingRow>
                  <SettingRow label="Привітання" hint="Порожньо — бот привітається сам" htmlFor="bot-greeting">
                    <Input
                      id="bot-greeting"
                      className={fieldControl}
                      value={form.greeting}
                      maxLength={300}
                      onChange={(event) => patch('greeting', event.target.value)}
                    />
                  </SettingRow>
                  <SaveBar saving={saving} onSave={saveProfile} />
                </SettingGroup>
                )}
                <OpenClawFields section="style" query={narrowed('style') ? needle : ''} />
                </div>
              ) : null}

              {current?.id === 'look' ? <LookSection /> : null}
              {current?.id === 'voice' ? (
                <div className="space-y-6">
                  {narrowed('voice') ? null : <VoiceSection />}
                  <OpenClawFields section="voice" query={narrowed('voice') ? needle : ''} />
                </div>
              ) : null}
              {current?.id === 'brain' ? (
                <div className="space-y-6">
                  {narrowed('brain') ? null : <BrainSection setup={setup.data!} />}
                  <OpenClawFields section="brain" query={narrowed('brain') ? needle : ''} />
                </div>
              ) : null}
              {current?.id === 'skills' ? <StoreSection /> : null}
              {current?.id === 'tools' ? (
                <div className="space-y-6">
                  {narrowed('tools') ? null : <ToolsSection />}
                  <OpenClawFields section="tools" query={narrowed('tools') ? needle : ''} />
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SaveBar({ saving, onSave }: { saving: boolean; onSave: () => void }) {
  return (
    <div className="flex justify-end px-4 py-3">
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
    <div className="space-y-6">
      <SettingGroup label={t('settings.group.screen')}>
      <SettingRow label="Тема" hint={glue('Зберігається в цьому браузері')}>
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
      </SettingRow>

      <SettingRow label={lookT('look.popups')}>
        <JellyRadio
          ariaLabel={lookT('look.popupsAria')}
          value={popup}
          onChange={(next) => setPopup(next as typeof popup)}
          items={[
            { value: 'solid', label: lookT('look.popupStandard') },
            { value: 'glass', label: lookT('look.popupGlass') },
          ]}
          radius={999}
          chipColor={surface2}
          activeColor={accentColor}
          textColor={ink}
          activeTextColor={accentInk}
        />
      </SettingRow>

      <SettingRow label="Мова">
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
      </SettingRow>

      <SettingRow label="Акцент">
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
      </SettingRow>
      </SettingGroup>
    </div>
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
    <SettingGroup label={t('settings.group.model')}>
      <SettingRow label="Модель" hint={glue('Картинки й прямий виклик. Чат відповідає моделлю OpenClaw.')}>
        <Select className={fieldControl} value={model} onChange={(event) => void saveModel(event.target.value)}>
          {setup.models.map((item) => (
            <option key={item.id} value={item.id}>{item.label || item.id}</option>
          ))}
        </Select>
      </SettingRow>
      <SettingRow
        label="Omni API-ключ"
        hint={setup.keys_set.omni ? 'Уже заданий — залиш порожнім, щоб не міняти' : 'Не заданий'}
        htmlFor="omni-key"
      >
        <Input
          id="omni-key"
          className={fieldControl}
          type="password"
          autoComplete="off"
          value={omni}
          onChange={(event) => setOmni(event.target.value)}
          placeholder={setup.keys_set.omni ? '••••••••' : 'вставити ключ'}
        />
      </SettingRow>
      <SettingRow
        label="OpenClaw токен"
        hint={setup.keys_set.openclaw ? 'Уже заданий — залиш порожнім, щоб не міняти' : 'Не заданий'}
        htmlFor="openclaw-token"
      >
        <Input
          id="openclaw-token"
          className={fieldControl}
          type="password"
          autoComplete="off"
          value={openclaw}
          onChange={(event) => setOpenclaw(event.target.value)}
          placeholder={setup.keys_set.openclaw ? '••••••••' : 'вставити токен'}
        />
      </SettingRow>
      <div className="flex justify-end px-4 py-3">
        <Button variant="solid" disabled={busy || (!omni && !openclaw)} onClick={saveKeys}>
          {busy ? 'Зберігаю…' : 'Зберегти ключі'}
        </Button>
      </div>
    </SettingGroup>
  );
}
