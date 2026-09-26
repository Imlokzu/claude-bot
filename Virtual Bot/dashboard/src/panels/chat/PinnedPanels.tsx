import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as Popover from '@radix-ui/react-popover';
import { Check, Clock, Eye, Folder, Gauge, ListTodo, Monitor, Plus, ArrowUpRight, Wallet, X } from 'lucide-react';
import { get } from '@/lib/api';
import { t } from '@/locales/workspace';
import { cn } from '@/lib/cn';
import { useBotEvents } from '@/hooks/useBotEvents';
import { estimateTokens, shortNumber } from './tokens';
import { Face } from './Face';
import { ClockPin } from './ClockPin';
import { OpenClawUsagePin } from './OpenClawUsagePin';
import { PIN_IDS, PINS_KEY, parsePins, type PinId } from './pins';
import type { ChatMessage } from './types';

const ICONS = { projects: Folder, vision: Eye, screen: Monitor, todo: ListTodo, usage: Wallet, clock: Clock, openclaw: Gauge };

function ProjectsPin() {
  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => get<{ projects: { id: string; name: string }[] }>('/api/projects'),
    staleTime: 60_000,
  });
  if (projects.isPending) return <p className="text-xs text-ink-3">{t('pins.loading')}</p>;
  if (projects.isError) return (
    <div className="text-xs text-ink-3" role="status">
      <p>{t('pins.error')}</p>
      <button className="mt-2 text-accent" onClick={() => void projects.refetch()}>{t('pins.retry')}</button>
    </div>
  );
  if (!projects.data.projects.length) return <p className="text-xs text-ink-3">{t('pins.empty')}</p>;
  return (
    <div className="max-h-44 space-y-1 overflow-y-auto">
      {projects.data.projects.map((project) => (
        <a key={project.id} href={`#/chat?project=${encodeURIComponent(project.id)}`}
           className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] text-ink-2 hover:bg-surface-3 hover:text-ink">
          <Folder size={14} className="shrink-0" /><span className="truncate">{project.name || project.id}</span>
        </a>
      ))}
    </div>
  );
}

interface TodoItem { text?: string; done?: boolean }
interface TodoData { title?: string; items?: TodoItem[] }

/* Чекліст, який бот створює тулзою todo_list. Подія приходить живцем через
   SSE, а бекенд шле останню версію ще й одразу після підключення — тож список
   переживає перезавантаження вкладки. Галочки тут лише для читання: станом
   володіє бот, він же його й оновлює наступним викликом. */
function TodoPin() {
  const [todo, setTodo] = useState<TodoData | null>(null);
  useBotEvents((event) => {
    if (event.type !== 'ui' || event.kind !== 'todo') return;
    setTodo(event.data && typeof event.data === 'object' ? event.data as TodoData : null);
  });
  const items = todo?.items ?? [];
  if (!items.length) return <p className="text-xs text-ink-3">{t('pins.todoEmpty')}</p>;
  const doneCount = items.filter((item) => item.done).length;
  return (
    <div>
      {todo?.title ? <p className="mb-1.5 truncate text-[11px] font-medium text-ink-2">{todo.title}</p> : null}
      <ul className="max-h-44 space-y-1 overflow-y-auto">
        {items.map((item, index) => (
          <li key={`${item.text}-${index}`} className="flex items-center gap-2 text-[12.5px] text-ink-2">
            <span className={cn(
              'grid size-4 shrink-0 place-items-center rounded border',
              item.done ? 'border-accent bg-accent-soft' : 'border-line',
            )}>
              {item.done ? <Check size={11} className="text-accent" /> : null}
            </span>
            <span className={cn('min-w-0 flex-1 truncate', item.done && 'text-ink-3 line-through')}>
              {item.text}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-[10.5px] text-ink-3">{doneCount}/{items.length}</p>
    </div>
  );
}

/* Витрати поточної розмови: вхідні/вихідні токени та груба оцінка в грошах.
   Це ОЦІНКА з видимої історії — точні числа знає лише провайдер, тож підпис
   чесно каже про це, а не видає похибку за факт. */
function UsagePin({ messages }: { messages: ChatMessage[] }) {
  const userMessages = messages.filter((m) => m.role === 'user');
  const botMessages = messages.filter((m) => m.role === 'assistant');
  const input = estimateTokens(userMessages);
  const output = estimateTokens(botMessages);
  // Середня ціна типового API (~$3 / $15 за мільйон). Більшість провайдерів
  // у ланцюгу безкоштовні, тож це стеля «скільки б це коштувало», а не рахунок.
  const cost = (input / 1_000_000) * 3 + (output / 1_000_000) * 15;
  return (
    <div className="space-y-1.5 text-[12.5px]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-ink-3">{t('pins.usageIn')}</span>
        <span className="u-data text-ink-2">≈{shortNumber(input)}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-ink-3">{t('pins.usageOut')}</span>
        <span className="u-data text-ink-2">≈{shortNumber(output)}</span>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-line pt-1.5">
        <span className="text-ink-3">{t('pins.usageCost')}</span>
        <span className="u-data text-ink-2">
          {cost < 0.01 ? '<$0.01' : `$${cost.toFixed(2)}`}
        </span>
      </div>
      <p className="text-[10.5px] leading-snug text-ink-3">{t('pins.usageNote')}</p>
    </div>
  );
}

function VisionPin() {
  const [streaming, setStreaming] = useState(false);
  const [failed, setFailed] = useState(false);
  // Match the direct-to-Vision contract; pinning alone must not start a camera.
  const streamUrl = new URL('/vision/stream.mjpg', window.location.href);
  streamUrl.port = '8000';
  return (
    <div>
      <div className="grid aspect-video place-items-center overflow-hidden rounded-sm bg-bg text-xs text-ink-3">
        {streaming ? (
          <img src={streamUrl.href} alt={t('pins.vision')} className="size-full object-contain"
               onError={() => { setStreaming(false); setFailed(true); }} />
        ) : <span role="status">{t(failed ? 'pins.cameraError' : 'pins.cameraOff')}</span>}
      </div>
      <button type="button" className="mt-2 text-xs text-ink-2 hover:text-ink" onClick={() => {
        setFailed(false);
        setStreaming((value) => !value);
      }}>{t(streaming ? 'pins.stop' : 'pins.watch')}</button>
    </div>
  );
}

export function PinnedPanels({ embedded = false, messages = [], sessionId = '' }: { embedded?: boolean; messages?: ChatMessage[]; sessionId?: string }) {
  const turn = messages.filter((m) => m.role === 'assistant').length;
  const [pins, setPins] = useState<PinId[]>(() => {
    try { return parsePins(localStorage.getItem(PINS_KEY)); } catch { return []; }
  });
  useEffect(() => {
    try { localStorage.setItem(PINS_KEY, JSON.stringify(pins)); } catch { /* Session-only fallback. */ }
  }, [pins]);
  const toggle = (id: PinId) => setPins((current) =>
    current.includes(id) ? current.filter((pin) => pin !== id) : [...current, id]);

  return (
    <aside
      aria-label={t('pins.title')}
      className={cn(
        'chat-pins flex min-h-0 shrink-0 flex-col bg-surface',
        embedded ? 'size-full' : 'w-[240px] border-l border-line',
      )}
    >
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <Face />
        {pins.map((id) => {
          const Icon = ICONS[id];
          const name = t(`pins.${id}`);
          return (
            <section key={id} data-pin={id} className="rounded-md border border-line bg-surface-2 p-2.5">
              <header className="mb-2 flex items-center gap-2">
                <Icon size={14} className="shrink-0 text-ink-3" />
                <h2 className="min-w-0 flex-1 truncate text-xs font-medium text-ink-2">{name}</h2>
                {id === 'todo' || id === 'usage' || id === 'clock' || id === 'openclaw' ? null : (
                <a href={id === 'screen' ? '/screen' : id === 'vision' ? '#/vision' : '#/overview'}
                   target={id === 'screen' ? '_blank' : undefined} rel={id === 'screen' ? 'noreferrer' : undefined}
                   aria-label={t('pins.open', { name })} className="pin-panel-action grid place-items-center rounded-xs text-ink-3 hover:text-ink"><ArrowUpRight size={13} /></a>
                )}
                <button type="button" aria-label={t('pins.remove', { name })} onClick={() => toggle(id)}
                        className="pin-panel-action grid place-items-center rounded-xs text-ink-3 hover:text-ink"><X size={13} /></button>
              </header>
              {id === 'projects' ? <ProjectsPin />
                : id === 'vision' ? <VisionPin />
                : id === 'todo' ? <TodoPin />
                : id === 'usage' ? <UsagePin messages={messages} />
                : id === 'clock' ? <ClockPin />
                : id === 'openclaw' ? <OpenClawUsagePin sessionId={sessionId} turn={turn} />
                : (
                <div className="pin-screen overflow-hidden rounded-sm bg-bg">
                  <iframe src="/screen" title={name} className="pin-screen-frame border-0" />
                </div>
              )}
            </section>
          );
        })}
      </div>
      <footer className="shrink-0 border-t border-line p-3 [padding-bottom:max(12px,env(safe-area-inset-bottom))]">
        <Popover.Root>
          <Popover.Trigger asChild>
            <button type="button" className="pins-add-trigger flex min-h-11 w-full items-center justify-between rounded-sm px-2 py-2 text-xs text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink">
              <span>{t('pins.add')}</span><Plus size={16} />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content side="top" align="end" sideOffset={10} collisionPadding={12}
              className="popup-shell u-pop z-50 w-56 rounded-md border border-line bg-surface p-1.5 shadow-pop">
              <div className="popup-plate liquid-glass" aria-hidden="true" />
              {PIN_IDS.map((id) => {
                const Icon = ICONS[id];
                return (
                  <button key={id} type="button" aria-pressed={pins.includes(id)} onClick={() => toggle(id)}
                    className="flex min-h-11 w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-[13px] text-ink-2 hover:bg-surface-2">
                    <Icon size={15} /><span className="flex-1">{t(`pins.${id}`)}</span>
                    {pins.includes(id) ? <Check size={14} className="text-accent" /> : <Plus size={14} />}
                  </button>
                );
              })}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </footer>
    </aside>
  );
}
