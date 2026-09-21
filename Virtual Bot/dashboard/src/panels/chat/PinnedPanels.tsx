import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as Popover from '@radix-ui/react-popover';
import { Check, Eye, Folder, Monitor, Plus, ArrowUpRight, X } from 'lucide-react';
import { get } from '@/lib/api';
import { t } from '@/locales/workspace';
import { cn } from '@/lib/cn';
import { Face } from './Face';
import { PIN_IDS, PINS_KEY, parsePins, type PinId } from './pins';

const ICONS = { projects: Folder, vision: Eye, screen: Monitor };

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

export function PinnedPanels({ embedded = false }: { embedded?: boolean }) {
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
                <a href={id === 'screen' ? '/screen' : id === 'vision' ? '#/vision' : '#/overview'}
                   target={id === 'screen' ? '_blank' : undefined} rel={id === 'screen' ? 'noreferrer' : undefined}
                   aria-label={t('pins.open', { name })} className="rounded-xs p-1 text-ink-3 hover:text-ink"><ArrowUpRight size={13} /></a>
                <button type="button" aria-label={t('pins.remove', { name })} onClick={() => toggle(id)}
                        className="rounded-xs p-1 text-ink-3 hover:text-ink"><X size={13} /></button>
              </header>
              {id === 'projects' ? <ProjectsPin /> : id === 'vision' ? <VisionPin /> : (
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
            <button type="button" className="flex w-full items-center justify-between rounded-sm px-2 py-2 text-xs text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink">
              <span>{t('pins.add')}</span><Plus size={16} />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content side="top" align="end" sideOffset={10} collisionPadding={12}
              className="u-pop z-50 w-56 rounded-md border border-line bg-surface p-1.5 shadow-pop">
              {PIN_IDS.map((id) => {
                const Icon = ICONS[id];
                return (
                  <button key={id} type="button" aria-pressed={pins.includes(id)} onClick={() => toggle(id)}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-[13px] text-ink-2 hover:bg-surface-2">
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
