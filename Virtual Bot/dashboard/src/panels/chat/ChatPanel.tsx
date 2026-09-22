import { useEffect, useMemo, useState } from 'react';
import { AssistantRuntimeProvider } from '@assistant-ui/react';
import { createPortal } from 'react-dom';
import { MessagesSquare, PanelRightOpen, X } from 'lucide-react';
import { Thread } from './Thread';
import { Composer } from './Composer';
import { SessionList } from './SessionList';
import { Face } from './Face';
import { PinnedPanels } from './PinnedPanels';
import { useChatRuntime } from './useChatRuntime';
import { useIsDesk, useIsPhone } from '@/hooks/useMediaQuery';
import { useDrawer } from '@/hooks/useDrawer';
import { useRouteParam } from '@/app/useRoute';
import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/Dialog';
import { t as workspaceT } from '@/locales/workspace';

/*
 * Чат. Три колонки на столі: розмови | стрічка | обличчя.
 *
 * На вужчих екранах колонки згортаються, а не стискаються: список розмов
 * їде в шухляду, обличчя стає маленьким у шапці. Стиснута до 120 px колонка
 * не економить місце — вона просто перестає працювати.
 */
/** Плашка «зараз показані розмови проєкту» з виходом назад до всіх. */
function ProjectChip({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-line px-3 py-2">
      <span className="u-label truncate text-accent">{name}</span>
      <button
        type="button"
        aria-label="Показати всі розмови"
        className="ml-auto rounded-xs p-0.5 text-ink-3 transition-colors hover:text-ink"
        onClick={() => {
          window.location.hash = '#/chat';
        }}
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

export default function ChatPanel() {
  const isPhone = useIsPhone();
  const isDesk = useIsDesk();
  const chat = useChatRuntime();
  const listDrawer = useDrawer();
  const [panelsOpen, setPanelsOpen] = useState(false);

  useEffect(() => {
    window.__vbotSendMessage = (text: string) => {
      // UI questions can arrive while the originating tool turn is still
      // winding down. Cancel that turn first so the selected answer is not
      // silently rejected by the single-flight send guard.
      if (chat.running) {
        void chat.cancel().then(() => chat.send(text));
      } else {
        void chat.send(text);
      }
    };
    return () => { delete window.__vbotSendMessage; };
  }, [chat.send]);

  /*
   * Проєкт із адреси (`#/chat?project=cats`) — так тека проєктів з «Огляду»
   * справді відкривається, а не просто веде в спільний список.
   */
  const project = useRouteParam('project');
  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => get<{ projects: { id: string; name: string }[] }>('/api/projects'),
    enabled: Boolean(project),
    staleTime: 60_000,
  });
  const projectName =
    projects.data?.projects.find((item) => item.id === project)?.name || project;

  const sessions = useMemo(
    () => (project ? chat.sessions.filter((item) => item.project === project) : chat.sessions),
    [chat.sessions, project],
  );



  // Відкриваємо найсвіжішу розмову при вході в розділ — повернутись до неї
  // хочеться майже завжди, а порожній екран змушує шукати її руками.
  useEffect(() => {
    if (chat.sessionId || chat.sessionsLoading || sessions.length === 0) return;
    void chat.openSession(sessions[0].id);
    // Один раз на завантаження списку (і ще раз при зміні проєкту).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.sessionsLoading, project]);

  const list = (
    <SessionList
      sessions={sessions}
      loading={chat.sessionsLoading}
      current={chat.sessionId}
      onOpen={(id) => {
        void chat.openSession(id);
        listDrawer.setOpen(false);
      }}
      onNew={() => {
        chat.newSession();
        listDrawer.setOpen(false);
      }}
    />
  );

  return (
    <AssistantRuntimeProvider runtime={chat.runtime}>
      <div className="chat-layout flex min-h-0 flex-1">
        {isDesk ? (
          <aside className="chat-sessions flex min-h-0 w-[220px] shrink-0 flex-col border-r border-line bg-surface">
            {project ? <ProjectChip name={projectName} /> : null}
            {list}
          </aside>
        ) : null}

        <div className="chat-conversation relative flex min-h-0 min-w-0 flex-1 flex-col">
          {!isDesk ? (
            <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
              <Button
                variant="ghost"
                size="sm"
                className="min-w-0 flex-1"
                aria-label="Розмови"
                aria-expanded={listDrawer.open}
                onClick={() => listDrawer.setOpen(true)}
              >
                <MessagesSquare />
                <span className="max-w-[150px] truncate">
                  {chat.sessions.find((s) => s.id === chat.sessionId)?.title || 'Нова розмова'}
                </span>
              </Button>
              {listDrawer.open
                ? createPortal(
                    <>
                      <div
                        {...listDrawer.veilProps}
                        className="u-veil fixed inset-0"
                        style={{ background: 'var(--c-overlay)', zIndex: 'var(--z-drawer)' }}
                      />
                      <div
                        {...listDrawer.panelProps}
                        aria-label="Розмови"
                        className="u-sheet-l u-safe-t u-safe-b fixed inset-y-0 left-0 flex w-[300px] max-w-[85vw] flex-col border-r border-line bg-surface"
                        style={{ zIndex: 'var(--z-drawer)' }}
                      >
                        <header className="flex items-center justify-between border-b border-line px-4 py-3">
                          <span className="text-[15px] font-semibold text-ink">Розмови</span>
                          <button
                            type="button"
                            aria-label="Закрити"
                            onClick={() => listDrawer.setOpen(false)}
                            className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-ink-3"
                          >
                            <X size={18} />
                          </button>
                        </header>
                        {project ? <ProjectChip name={projectName} /> : null}
                        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{list}</div>
                      </div>
                    </>,
                    document.body,
                  )
                : null}
              <div className="flex-1" />
              <Dialog open={panelsOpen} onOpenChange={setPanelsOpen}>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="icon-sm" className="shrink-0" aria-label={workspaceT('pins.title')}>
                    <PanelRightOpen />
                  </Button>
                </DialogTrigger>
                <DialogContent
                  title={workspaceT('pins.title')}
                  side={isPhone ? 'bottom' : 'center'}
                  className="h-[min(78dvh,680px)] p-0"
                  bodyClassName="p-0 sm:p-0"
                >
                  <PinnedPanels embedded />
                </DialogContent>
              </Dialog>
              <Face compact className="h-9 w-16 shrink-0" />
            </div>
          ) : null}

          <Thread
            compactedFrom={chat.compactedFrom}
            composer={
              <Composer
                busy={chat.running}
                usedTokens={chat.usedTokens}
                sessionId={chat.sessionId}
                onSend={chat.send}
                onStop={chat.cancel}
                // Після стискання на диску лежить уже переказ — перечитуємо
                // розмову, інакше на екрані лишились би репліки, яких у
                // контексті бота вже немає.
                onCompacted={() => void chat.openSession(chat.sessionId)}
              />
            }
          />
        </div>

        {isDesk ? (
          <PinnedPanels />
        ) : null}
      </div>
    </AssistantRuntimeProvider>
  );
}
