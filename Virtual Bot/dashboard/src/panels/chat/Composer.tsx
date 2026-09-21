import { useMemo, useRef } from 'react';
import { Brain, Eye, FileText, Globe, LifeBuoy, Paperclip, Zap } from 'lucide-react';
import VoiceBeam from 'voice-glow';
import { PromptBar } from '@/vendor/reactbits';
import { useToast } from '@/components/ui/Toaster';
import { post } from '@/lib/api';
import { useBrainModels, useSelectBrainModel, useSetThinking, type BrainModel } from '@/lib/queries';
import { useCssVar } from '@/hooks/useAccentRgb';
import { useDictation } from '@/hooks/useDictation';
import { ContextMeter } from './ContextMeter';

/*
 * Поле вводу — це PromptBar із React Bits (reactbits.dev/c/micro), як є.
 *
 * Своя версія цього рядка колись була й повторювала його гірше. Ми лише
 * підключаємо його до бекенда й додаємо збоку те, чого в ньому немає:
 * запас контексту та радіальне меню замість «+».
 *
 * ГОЛОВНЕ про список моделей. Раніше тут стояв список Omni з config.yaml —
 * і вибір НЕ ВПЛИВАВ ні на що: у чаті відповідає OpenClaw своєю моделлю,
 * тож на екрані могло бути «MiniMax M3», поки насправді писав gpt-oss-120b.
 * Тепер список беремо з самого OpenClaw (`openclaw models list`), а вибір
 * їде заголовком `x-openclaw-model` — тобто вибирає те, що й показує.
 */

/** Рівні думання — рівно ті, що знає OpenClaw (agents.defaults.thinkingDefault). */
const THINKING_LABELS: Record<string, string> = {
  off: 'Без думання',
  minimal: 'Мінімально',
  low: 'Трохи',
  medium: 'Середньо',
  high: 'Глибоко',
  xhigh: 'Дуже глибоко',
  adaptive: 'За потребою',
  max: 'Максимум',
  ultra: 'Ультра',
};

/*
 * Особливості моделі — значками, не текстом.
 *
 * Каталог OpenClaw називає їх прямо в назві: «GLM-5.3 Flash (бачить
 * картинки, ~2.5 с)». У рядку композера такий підпис обрізався саме на
 * корисному місці, тому бекенд розбирає хвіст на ознаки (див.
 * openclaw_models._normalize), а тут вони стають двома значками.
 *
 * Поруч із назвою — лише ті дві, що впливають на вибір просто зараз: чи
 * побачить вкладену картинку і чи відповість швидко. Хто типовий, а хто
 * запасний, видно лише в розгорнутому списку: у рядку це шум.
 */
const TRAITS = [
  { key: 'vision', Icon: Eye, title: () => 'бачить картинки' },
  {
    key: 'fast',
    Icon: Zap,
    title: (model: BrainModel) =>
      model.seconds ? `швидка — близько ${model.seconds} с` : 'швидка',
  },
] as const;

/** Значки другого ряду: роль моделі в ланцюжку OpenClaw. */
const ROLES = [
  { key: 'is_default', Icon: Brain, title: 'типова модель OpenClaw' },
  { key: 'fallback', Icon: LifeBuoy, title: 'запасна модель OpenClaw' },
] as const;

export function Composer({
  busy,
  usedTokens,
  sessionId,
  onSend,
  onStop,
  onCompacted,
}: {
  busy: boolean;
  usedTokens: number;
  sessionId: string;
  onSend: (text: string, attachments?: unknown[]) => void;
  onStop: () => void;
  onCompacted: () => void;
}) {
  const brain = useBrainModels();
  const selectModel = useSelectBrainModel();
  const setThinking = useSetThinking();
  const dictation = useDictation();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);

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
        toast.error('Файл не додався', (error as Error).message);
      }
    }
    return uploaded;
  };

  const surface = useCssVar('--c-surface', '#fffdf8');
  const surface3 = useCssVar('--c-surface-3', '#e5ddd0');
  const ink = useCssVar('--c-text', '#231e19');
  const accent = useCssVar('--c-accent', '#b95f3d');

  const models = brain.data?.models ?? [];
  // Порожній `selected` означає «лишаємо типову модель агента» — показуємо
  // саме її, бо відповідатиме вона.
  const current = brain.data?.selected || brain.data?.default || '';
  const currentModel = models.find((model) => model.id === current);
  const contextSize = currentModel?.context ?? 0;

  const modelList = useMemo(
    () =>
      models.map((model) => ({
        key: model.id,
        // Назва вузлом, а не рядком: PromptBar малює її і в згорнутому
        // рядку, і в списку — значки мусять бути в обох місцях.
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
    [models],
  );

  const pickerModels = models.length > 0 ? modelList : [{
    key: '__openclaw-loading__',
    name: <span className="text-ink-3">OpenClaw</span>,
    tag: <span className="text-[10px] text-ink-3">завантаження</span>,
  }];

  /*
   * Рівні беремо з відповіді бекенда, а не зі свого уявлення: у HTTP-шлюзі
   * OpenClaw поля під reasoning немає взагалі, і єдиний живий важіль — його
   * конфіг, який знає рівно цей перелік.
   *
   * Перший пункт — «як у OpenClaw»: рівень може бути НЕ ЗАДАНИЙ, і тоді діє
   * вбудоване значення, якого CLI не називає. Показати замість нього «off»
   * означало б назвати невідоме конкретним — а це різні стани, і повернутись
   * із «off» у «не задано» інакше було б неможливо.
   */
  const AS_CONFIGURED = 'Як у OpenClaw';
  const levels = brain.data?.thinking_levels ?? [];
  const efforts = useMemo(
    () => [AS_CONFIGURED, ...levels.map((level) => THINKING_LABELS[level] ?? level)],
    [levels],
  );
  const effortByLabel = useMemo<Record<string, string>>(
    () => ({
      [AS_CONFIGURED]: '',
      ...Object.fromEntries(levels.map((level) => [THINKING_LABELS[level] ?? level, level])),
    }),
    [levels],
  );
  const currentThinking = brain.data?.thinking || '';

  /*
   * Модельний каталог може запускати CLI OpenClaw і відповідати кілька секунд.
   * Поле вводу не можна ховати через це: показуємо стабільний fallback, а
   * picker заміниться реальним списком після відповіді каталогу.
   *
   * PromptBar читає `defaultModel` ЛИШЕ при монтуванні. Якщо змонтувати його
   * до відповіді бекенда, всередині осяде порожній ключ, і в рядку назавжди
   * стоятиме перша модель списку — тобто знову не та, що відповідає.
   * Каталог кешується на дві хвилини, тож ця заглушка видима один раз.
   */
  return (
    <div className="chat-composer u-safe-b shrink-0 px-4 pb-3 pt-2 sm:px-6">
      <div className="mx-auto flex w-full max-w-[760px] flex-col items-stretch gap-1.5">
        {/*
          Сяйво накладене ПОВЕРХ поля, а не обгортає його.
          
          voice-glow ставить своїй обгортці `overflow: hidden` — щоб обрізати
          сяйво по заокругленню поля. Коли поле лежало всередині, під той самий
          ніж потрапляли і його меню: список моделей, рівень думання, радіальне
          «+» — усе, що розкривається вгору, зрізало рівно по краю рядка, і
          здавалося, що попапи «застрягли». Тепер обгортка накладається зверху
          порожньою рамкою того самого розміру: сяйво те саме, а меню їй більше
          не діти.
        */}
        <div className="relative">
          <PromptBar
            placeholder="Напиши боту…"
            labels={{
              effort: 'Думання',
              effortHint: 'Глибше думання — довша відповідь. Це налаштування OpenClaw, воно діє на всі розмови.',
              faster: 'Швидше',
              smarter: 'Розумніше',
              sources: 'Джерела',
              commands: 'Команди',
              models: 'Моделі',
              chooseModel: 'Обрати модель',
              chooseEffort: 'Рівень думання',
              prompt: 'Повідомлення боту',
              add: 'Додати до розмови',
              listening: 'Слухаю…',
              dictate: 'Продиктувати',
              stopDictation: 'Припинити диктування',
              send: 'Надіслати',
              stop: 'Зупинити',
            }}
            width="100%"
            radius={16}
            maxRows={8}
            busy={busy}
            background={surface}
            color={ink}
            menuBackground={surface3}
            sparkColor={accent}
            models={pickerModels}
            sources={[
              { key: 'files', name: 'Файли', description: 'Завантажити з пристрою', icon: Paperclip, attach: true },
              { key: 'web', name: 'Пошук у мережі', description: 'Знайти актуальне', icon: Globe },
              { key: 'memory', name: 'Памʼять', description: 'Додати нотатку', icon: FileText },
            ]}
            defaultModel={current || '__openclaw-loading__'}
            efforts={efforts}
            defaultEffort={currentThinking ? THINKING_LABELS[currentThinking] ?? currentThinking : AS_CONFIGURED}
            /*
             * Рівень думання — це НАЛАШТУВАННЯ OpenClaw, а не властивість
             * однієї репліки: поля під reasoning у його HTTP-ендпоінта немає,
             * тож рівень ставиться в конфіг і діє далі на всі розмови.
             * Тому й повідомляємо про це вголос.
             */
            onEffortChange={(label) => {
              const level = effortByLabel[label];
              if (level === undefined || level === currentThinking) return;
              setThinking.mutate(level, {
                onSuccess: () =>
                  toast.toast(`Рівень думання: ${label}`, {
                    description: level
                      ? 'Записано в конфіг OpenClaw — діє на всі розмови'
                      : 'Налаштування знято — діє вбудоване значення OpenClaw',
                  }),
                onError: (error) => toast.error('Рівень не прийнявся', (error as Error).message),
              });
            }}
            onModelChange={(key) =>
              key === '__openclaw-loading__' ? undefined :
              selectModel.mutate(key, {
                onError: (error) => toast.error('Модель не прийнялась', (error as Error).message),
              })
            }
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
              { key: 'memory', name: '/памʼять', description: 'Що ти про мене памʼятаєш' },
              { key: 'files', name: '/файли', description: 'Покажи робочу теку' },
              { key: 'status', name: '/стан', description: 'Що зараз працює' },
            ]}
            onSend={(text, meta) => onSend(text, meta.attachments)}
            onStop={onStop}
            /*
             * Диктування зупиняється саме — по тиші: PromptBar не дає «стоп»,
             * а лише скасовує очікування, і текст, розпізнаний після повторного
             * натиску, просто зникав би (див. useDictation).
             */
            /* Натиснули мікрофон удруге — закриваємо фразу й одразу віддаємо
               її на розпізнавання, а не чекаємо на тишу. Мікрофон при цьому
               глушиться: тримати його відкритим після «договорив» нема за що. */
            onDictateStop={dictation.finish}
            onDictate={async () => {
              const text = await dictation.listen();
              if (!text && dictation.error) toast.error('Диктування', dictation.error);
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
               * Поки мікрофон не слухає, сяйва НЕМАЄ зовсім: `active` гасить
               * ефект, `idle=0` прибирає «дихання» в тиші. Типове дихання
               * світилось би під полем постійно й перетворило б показник
               * запису на просту прикрасу.
               */
              active={Boolean(dictation.stream)}
              idle={0}
              /* Радіус беремо з поля: дитина тут порожня, і компоненту
                 нема з чого його вивести самому. */
              borderRadius={16}
            >
              <div className="size-full" />
            </VoiceBeam>
          </div>
        </div>

        {/*
          Чорновик, поки фраза ще триває. Без нього диктування виглядає як
          порожнє очікування: мікрофон горить, а на екрані нічого — і
          незрозуміло, чи тебе взагалі чують. Остаточний текст усе одно
          порахує повна модель і вставить його в поле.
        */}
        {dictation.recognizing ? (
          <p className="self-center text-[12px] italic text-ink-3">розпізнаю…</p>
        ) : dictation.partial ? (
          <p className="self-center text-[12px] italic text-ink-3">чую: {dictation.partial}</p>
        ) : null}

        {/* Запас контексту. PromptBar про нього не знає, а знати треба: саме
            він пояснює, чому довга розмова починає «забувати». */}
        <div className="self-center">
          <ContextMeter
            sessionId={sessionId}
            contextSize={contextSize}
            usedTokens={usedTokens}
            onCompacted={onCompacted}
          />
        </div>
      </div>
    </div>
  );
}
