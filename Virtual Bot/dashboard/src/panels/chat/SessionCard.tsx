import { useMemo, useRef, useState } from 'react';
import { useIsPhone } from '@/hooks/useMediaQuery';
import * as Popover from '@radix-ui/react-popover';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, FolderInput, Pin, PinOff, Trash2 } from 'lucide-react';
import { useToast } from '@/components/ui/Toaster';
import { del, get, post } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { SessionSummary } from './types';

/*
 * Картка розмови — те, що видно при наведенні на рядок списку.
 *
 * Рядок вузький, назва в ньому обрізана, і все, що з розмовою можна
 * зробити, ховалось невідомо де. Картка відповідає на обидва: показує
 * назву цілком і дає дії просто тут — у проєкт, закріпити, видалити.
 *
 * Відкривається по наведенню, а не по кліку: клік по рядку вже зайнятий —
 * він відкриває саму розмову, і забирати його під меню не можна.
 */

interface Project {
  id: string;
  name: string;
}

function meta(session: SessionSummary): string {
  const parts: string[] = [];
  if (session.count) parts.push(`${session.count} ${plural(session.count)}`);
  if (session.updated) {
    parts.push(
      new Date(session.updated * 1000).toLocaleString('uk', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }),
    );
  }
  return parts.join(' · ');
}

function plural(count: number): string {
  const tail = count % 10;
  const teen = count % 100;
  if (teen >= 11 && teen <= 14) return 'реплік';
  if (tail === 1) return 'репліка';
  if (tail >= 2 && tail <= 4) return 'репліки';
  return 'реплік';
}

export function SessionCard({
  session,
  children,
  onDeleted,
  onOpen,
}: {
  session: SessionSummary;
  children: React.ReactNode;
  /** Відкрита розмова зникла — панель мусить піти на іншу. */
  onDeleted: (id: string) => void;
  onOpen?: () => void;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const isPhone = useIsPhone();
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [sure, setSure] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => get<{ projects: Project[] }>('/api/projects'),
    // Список потрібен лише коли картку справді розгорнули по «У проєкт».
    enabled: picking,
    staleTime: 60_000,
  });

  const refresh = () => void client.invalidateQueries({ queryKey: ['sessions'] });

  const setPinned = useMutation({
    mutationFn: (pinned: boolean) =>
      post(`/api/sessions/${encodeURIComponent(session.id)}/pin`, { pinned }),
    onSuccess: refresh,
    onError: (error: Error) => toast.error('Не вдалося закріпити', error.message),
  });

  const setProject = useMutation({
    mutationFn: (project: string) =>
      post(`/api/sessions/${encodeURIComponent(session.id)}/project`, { project }),
    onSuccess: (_data, project) => {
      refresh();
      const name = projects.data?.projects.find((item) => item.id === project)?.name;
      toast.toast(name ? `У проєкті «${name}»` : 'Знято з проєкту');
      close();
    },
    onError: (error: Error) => toast.error('Не вдалося перенести', error.message),
  });

  const remove = useMutation({
    mutationFn: () => del(`/api/sessions/${encodeURIComponent(session.id)}`),
    onSuccess: () => {
      refresh();
      onDeleted(session.id);
      toast.toast('Розмову видалено');
      close();
    },
    onError: (error: Error) => toast.error('Не вдалося видалити', error.message),
  });

  /*
   * Наміри, а не просто mouseenter/mouseleave.
   *
   * Відкриття із затримкою — щоб картка не вистрибувала під курсором, який
   * просто їде повз список; закриття із затримкою — щоб дістатись до самої
   * картки, не втративши її дорогою.
   */
  const plan = (next: boolean) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(
      () => {
        setOpen(next);
        if (!next) {
          setPicking(false);
          setSure(false);
        }
      },
      next ? 320 : 160,
    );
  };

  const close = () => {
    window.clearTimeout(timer.current);
    setOpen(false);
    setPicking(false);
    setSure(false);
  };

  const hover = { onMouseEnter: () => plan(true), onMouseLeave: () => plan(false) };

  /*
   * На телефоні наведення нема — замість нього довгий дотик (як нативне
   * контекстне меню). 420 мс: швидше — спрацьовувало б під час скролу,
   * довше — відчувалось би як гальмо. Рух пальцем чи скрол списку
   * скасовує таймер, інакше картка вистрибувала б посеред гортання.
   */
  const press = useRef<{ id: number; x: number; y: number; timer: number } | null>(null);

  const pressCancel = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  };

  const touch = {
    onPointerDown: (event: React.PointerEvent) => {
      if (event.pointerType !== 'touch') return;
      pressCancel();
      press.current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        timer: window.setTimeout(() => {
          press.current = null;
          setOpen(true);
          /* Легкий відгук, як у нативному меню. Де вібрації нема — тихо
             поверне false, і нічого не станеться. */
          navigator.vibrate?.(8);
        }, 420),
      };
    },
    onPointerMove: (event: React.PointerEvent) => {
      const state = press.current;
      if (!state || event.pointerId !== state.id) return;
      if (Math.hypot(event.clientX - state.x, event.clientY - state.y) > 10) pressCancel();
    },
    onPointerUp: pressCancel,
    onPointerCancel: pressCancel,
    /* Довгий дотик на iOS/Android сам по собі відкриває контекстне меню
       браузера й виділення — глушимо, бо свою картку ми вже показали. */
    onContextMenu: (event: React.MouseEvent) => {
      if (isPhone) event.preventDefault();
    },
  };

  const current = useMemo(
    () => projects.data?.projects.find((item) => item.id === session.project),
    [projects.data, session.project],
  );

  return (
    <Popover.Root open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <Popover.Anchor asChild>
        <div
          {...(isPhone ? touch : hover)}
          onClick={(event) => {
            if ((event.target as HTMLElement).closest('button')) return;
            onOpen?.();
          }}
        >{children}</div>
      </Popover.Anchor>

      <Popover.Content
        side={isPhone ? 'bottom' : 'right'}
        align={isPhone ? 'center' : 'start'}
        sideOffset={10}
        collisionPadding={12}
        avoidCollisions
        // Фокус лишається там, де був: картка — підказка, а не діалог, і
        // забирати в людини каретку з поля вводу вона не мусить.
        onOpenAutoFocus={(event) => event.preventDefault()}
        style={{ zIndex: 'var(--z-pop)' }}
        className="u-pop w-[min(268px,calc(100vw-24px))] rounded-md border border-line bg-surface p-3 shadow-pop outline-none"
        {...(isPhone ? {} : hover)}
      >
        {picking ? (
          <>
            <button
              type="button"
              onClick={() => setPicking(false)}
              className="mb-2 flex items-center gap-1 text-[12px] text-ink-3 transition-colors hover:text-ink"
            >
              <ChevronLeft className="size-3.5" /> назад
            </button>
            <div className="max-h-[220px] space-y-0.5 overflow-y-auto">
              <Choice
                active={!session.project}
                onClick={() => setProject.mutate('')}
                label="Без проєкту"
              />
              {projects.data?.projects.map((project) => (
                <Choice
                  key={project.id}
                  active={project.id === session.project}
                  onClick={() => setProject.mutate(project.id)}
                  label={project.name || project.id}
                />
              ))}
              {projects.isPending ? (
                <p className="px-2 py-1 text-[12px] text-ink-3">дивлюсь…</p>
              ) : null}
              {projects.data && projects.data.projects.length === 0 ? (
                <p className="px-2 py-1 text-[12px] text-ink-3">
                  Проєктів ще немає — їх заводять в «Огляді».
                </p>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <p className="text-[13px] font-medium leading-snug text-ink">
              {session.title || 'Без назви'}
            </p>
            <p className="mt-1 text-[11px] text-ink-3">{meta(session)}</p>
            {current || session.project ? (
              <p className="mt-1 text-[11px] text-ink-2">
                проєкт: {current?.name || session.project}
              </p>
            ) : null}

            <div className="mt-2.5 flex flex-col gap-0.5 border-t border-line pt-2">
              <Action icon={<FolderInput />} onClick={() => setPicking(true)} label="У проєкт" />
              <Action
                icon={session.pinned ? <PinOff /> : <Pin />}
                onClick={() => setPinned.mutate(!session.pinned)}
                label={session.pinned ? 'Відкріпити' : 'Закріпити'}
              />
              {/*
               * Підтвердження прямо в кнопці, а не окремим вікном: питання
               * тут одне-єдине, і заради нього перекривати панель модалкою
               * надміру. Другий клік — і розмови немає.
               */}
              <Action
                icon={<Trash2 />}
                danger
                onClick={() => (sure ? remove.mutate() : setSure(true))}
                label={sure ? 'Точно видалити?' : 'Видалити'}
              />
            </div>
          </>
        )}
      </Popover.Content>
    </Popover.Root>
  );
}

function Action({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] transition-colors',
        '[&_svg]:size-[15px] [&_svg]:shrink-0',
        danger ? 'text-err hover:bg-err/10' : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function Choice({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] transition-colors',
        active ? 'bg-accent-soft text-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
      )}
    >
      <span className="truncate">{label}</span>
      {active ? <span className="shrink-0 text-[11px] text-accent">тут</span> : null}
    </button>
  );
}
