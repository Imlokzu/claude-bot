import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Menu, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Brand } from './Brand';
import { AuthCorner } from './AuthCorner';
import { Orb } from '@/vendor/aicss';
import { Morph } from '@/components/ui/Morph';
import { Dot } from '@/components/ui/Status';
import { toolLook } from '@/lib/toolLabels';
import { Tip } from '@/components/ui/Tip';
import { useBotEvents, useEventsConnected } from '@/hooks/useBotEvents';
import { useDockSide } from '@/hooks/useDockSide';
import { useIsPhone } from '@/hooks/useMediaQuery';
import { useDrawer } from '@/hooks/useDrawer';
import { SECTIONS } from '@/app/sections';
import { useRoute } from '@/app/useRoute';
import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';
import { useBrainModels, useModels, useStatus } from '@/lib/queries';

/*
 * Шапка тримає СТАН бота й нічого більше: налаштування вигляду живуть у
 * розділі «Налаштування». Так само було в старій панелі — правило перевірене,
 * переносимо як є.
 */
export function Topbar() {
  const isPhone = useIsPhone();
  const [section, navigate] = useRoute();
  const drawer = useDrawer();
  const status = useStatus();
  const models = useModels();
  const brain = useBrainModels();
  const eventsLive = useEventsConnected();
  const [side] = useDockSide();
  const [activity, setActivity] = useState<string | null>(null);

  // Чим бот зайнятий прямо зараз. Подія `tool` приходить зі стрічки, а не зі
  // стріму чату, бо тулзи можуть спрацювати й без репліки людини (дрімота,
  // зір, розклад).
  useBotEvents((event) => {
    if (event.type !== 'tool') return;
    const tool = String(event.tool ?? '');
    const state = String(event.state ?? 'start');
    setActivity(state === 'start' ? tool : null);
  });

  // Підпис «зайнятий» гасне сам: якщо тулз не закрився подією (упав, або
  // процес перезапустився), вічний напис брехав би.
  useEffect(() => {
    if (!activity) return;
    const timer = setTimeout(() => setActivity(null), 20_000);
    return () => clearTimeout(timer);
  }, [activity]);

  const backendOk = status.isSuccess;
  const brainId = brain.data?.selected || brain.data?.default || '';
  const brainModel = brain.data?.models.find((model) => model.id === brainId);
  const activeModel = brainModel?.label || brainId || models.data?.active || '';

  return (
    <header className="u-safe-t flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-3 sm:px-4"
            style={{ zIndex: 'var(--z-topbar)' }}>
      <Brand compact className="shrink-0" />

      {isPhone ? (
        <>
          <nav aria-label={t('nav.sections')} className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {SECTIONS.filter((item) => item.primary).map((item) => {
              const Icon = item.icon;
              const active = item.id === section;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => navigate(item.id)}
                  className={cn(
                    'flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] transition-colors',
                    active ? 'bg-accent-soft font-medium text-ink' : 'text-ink-3',
                  )}
                >
                  <Icon size={16} strokeWidth={active ? 2.1 : 1.75} />
                  <span>{item.label}</span>
                </button>
              );
            })}
            <button
              type="button"
              aria-label={t('nav.all')}
              aria-expanded={drawer.open}
              onClick={() => drawer.setOpen(true)}
              className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-ink-3"
            >
              <Menu size={18} />
            </button>
          </nav>

          {drawer.open
            ? createPortal(
                <>
                  <div
                    {...drawer.veilProps}
                    className="u-veil fixed inset-0"
                    style={{ background: 'var(--c-overlay)', zIndex: 'var(--z-drawer)' }}
                  />
                  <div
                    {...drawer.panelProps}
                    aria-label={t('nav.all')}
                    className="u-sheet-l u-safe-t u-safe-b fixed inset-y-0 left-0 flex w-[280px] max-w-[85vw] flex-col border-r border-line bg-surface"
                    style={{ zIndex: 'var(--z-drawer)' }}
                  >
                    <header className="flex items-center justify-between border-b border-line px-4 py-3">
                      <span className="text-[15px] font-semibold text-ink">{t('nav.sections')}</span>
                      <button
                        type="button"
                        aria-label={t('chat.close')}
                        onClick={() => drawer.setOpen(false)}
                        className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-ink-3"
                      >
                        <X size={18} />
                      </button>
                    </header>
                    <nav aria-label={t('nav.all')} className="flex-1 overflow-y-auto p-2">
                      {SECTIONS.map((item) => {
                        const Icon = item.icon;
                        const active = item.id === section;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            aria-current={active ? 'page' : undefined}
                            onClick={() => {
                              navigate(item.id);
                              drawer.setOpen(false);
                            }}
                            className={cn(
                              'flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-left text-[14px] transition-colors',
                              active ? 'bg-accent-soft font-medium text-ink' : 'text-ink-2',
                            )}
                          >
                            <Icon size={17} strokeWidth={active ? 2.1 : 1.75} />
                            <span>{item.label}</span>
                          </button>
                        );
                      })}
                    </nav>
                  </div>
                </>,
                document.body,
              )
            : null}
        </>
      ) : null}

      {/*
        Порожня середина шапки — це місце для дока, коли він стоїть зверху.
        Він потрапляє сюди порталом із DockNav (там же лишається все
        перенесення), а не окремою смугою під шапкою: друга смуга поруч
        з'їдала ще 84 px і читалась як дві випадково злиплі панелі.
      */}
      <div
        className={cn("min-w-0 flex-1 items-center justify-center gap-3", isPhone ? "hidden" : "flex")}
        // Значок під курсором виростає нижче за смугу — хай виростає.
        style={side === 'top' ? { overflow: 'visible' } : undefined}
      >
        <div id="dock-slot" className="flex items-center" />

        <AnimatePresence>
          {activity ? (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16 }}
              className="flex w-fit shrink-0 items-center gap-2 rounded-full border border-line bg-surface-2 px-3 py-1"
            >
              {/* Орб (aicss.dev/r/orbs) замість крапки: у кожної дії свій
                  рух, тож із іншого кінця кімнати видно не просто «щось
                  робить», а що саме — шукає, пише чи читає. Підпис —
                  людською мовою, бо `web_search` у шапці нічого не пояснює. */}
              <Orb variant={toolLook(activity).orb} size={15} />
              <Morph className="text-[12px] text-ink-2">
                {toolLook(activity).verb}
              </Morph>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      {activeModel && !isPhone ? (
        <Tip content={t('topbar.model')} side="bottom">
          <span className="hidden max-w-[180px] truncate font-mono text-[11px] text-ink-3 sm:block">
            <Morph mono>{activeModel}</Morph>
          </span>
        </Tip>
      ) : null}

      {/* На телефоні шапка лишає лише навігацію: лампочки статусу й бейдж
          режиму їдять рядок, який і так вузький. */}
      {!isPhone ? (
        <>
          <Tip
            content={backendOk ? 'Бекенд відповідає' : 'Бекенд не відповідає'}
            side="bottom"
          >
            <span className="flex size-8 items-center justify-center">
              <Dot kind={status.isPending ? 'idle' : backendOk ? 'ok' : 'err'} />
            </span>
          </Tip>

          <Tip content={eventsLive ? 'Стрічка подій жива' : 'Стрічка подій обірвана'} side="bottom">
            <span className="flex size-8 items-center justify-center">
              <Dot kind={eventsLive ? 'ok' : 'idle'} />
            </span>
          </Tip>

          <AuthCorner />
        </>
      ) : null}
    </header>
  );
}
