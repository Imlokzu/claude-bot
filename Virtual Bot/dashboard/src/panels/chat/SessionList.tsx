import { useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { AnimatedList, PulseHeart, SwipeRow } from '@/vendor/reactbits';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { Empty, SkeletonList } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toaster';
import { useCssVar } from '@/hooks/useAccentRgb';
import { del, post } from '@/lib/api';
import { SessionCard } from './SessionCard';
import type { SessionSummary } from './types';

/*
 * Список розмов.
 *
 * Прокрутка, поява рядків і затемнення по краях — AnimatedList з React
 * Bits. Свій тут вміст рядка й два способи дістатись до дій:
 *
 *   змах убік (SwipeRow) — те, що працює пальцем і чого не треба шукати;
 *   картка по наведенню (SessionCard) — повна назва, скільки реплік, коли
 *   востаннє, і кнопки; те, що працює мишею.
 *
 * Два способи, бо один рядок 13-м кеглем не вміщає ні назви цілком, ні
 * кнопок, а ховати все за «…» означає зробити зайвий клік обов'язковим.
 */

function when(ts?: number): string {
  if (!ts) return '';
  const date = new Date(ts * 1000);
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? date.toLocaleTimeString('uk', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('uk', { day: '2-digit', month: '2-digit' });
}

export function SessionList({
  sessions,
  loading,
  current,
  onOpen,
  onNew,
  className,
}: {
  sessions: SessionSummary[];
  loading: boolean;
  current: string;
  onOpen: (id: string) => void;
  onNew: () => void;
  className?: string;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const accent = useCssVar('--c-accent', '#b95f3d');
  const ink = useCssVar('--c-text', '#231e19');
  const faint = useCssVar('--c-text-3', '#958979');
  const surface = useCssVar('--c-surface', '#fffdf8');
  const surface3 = useCssVar('--c-surface-3', '#e5ddd0');
  const danger = useCssVar('--c-err', '#b2412e');

  const refresh = () => void client.invalidateQueries({ queryKey: ['sessions'] });

  const togglePin = async (session: SessionSummary, next: boolean) => {
    try {
      await post(`/api/sessions/${encodeURIComponent(session.id)}/pin`, { pinned: next });
      refresh();
    } catch (error) {
      toast.error('Не вдалося закріпити', (error as Error).message);
    }
  };

  /*
   * Видалення змахом — без перепитування, але з відкотом? Ні: чат_store
   * видаляє файл, повертати нема звідки. Тому змах лише ВІДКРИВАЄ шухляду,
   * а натиснути «Видалити» в ній — уже свідома дія (fullSwipe вимкнено).
   */
  const removeSession = async (session: SessionSummary) => {
    try {
      await del(`/api/sessions/${encodeURIComponent(session.id)}`);
      refresh();
      if (session.id === current) onNew();
      toast.toast('Розмову видалено');
    } catch (error) {
      toast.error('Не вдалося видалити', (error as Error).message);
    }
  };

  const items = sessions.map((session) => {
    const row = (
      <div
        className={cn(
          'flex size-full items-center gap-1.5 rounded-sm px-2.5 py-1 transition-colors',
          session.id === current ? 'bg-accent-soft text-ink' : 'text-ink-2 hover:bg-surface-2',
        )}
      >
        <span className="min-w-0 flex-1 truncate text-[13px]">{session.title || 'Без назви'}</span>
        <span className="u-data shrink-0 text-[10px] text-ink-3">{when(session.updated)}</span>
        {/* Закріплення — окрема дія всередині рядка, тож клік по ній не має
            відкривати розмову. */}
        <span
          onClick={(event) => {
            event.stopPropagation();
          }}
          className="shrink-0"
        >
          <PulseHeart
            icon="star"
            size={18}
            showCount={false}
            liked={!!session.pinned}
            onChange={(next) => void togglePin(session, next)}
            likedColor={accent}
            idleColor={faint}
            pillColor="transparent"
            textColor={ink}
            label="Закріпити"
          />
        </span>
      </div>
    );

    return (
      <SessionCard
        key={session.id}
        session={session}
        onDeleted={(id) => {
          if (id === current) onNew();
        }}
      >
        <SwipeRow
          className="session-swipe"
          height={30}
          radius={8}
          actionWidth={96}
          // Повний змах не видаляє: надто легко зробити випадково, а
          // повернути розмову нема звідки.
          fullSwipe={false}
          rowColor={surface}
          textColor={ink}
          drawerColor={surface3}
          actionColor={danger}
          label={session.title || 'Розмова'}
          actions={[
            { id: 'delete', label: 'Видалити' },
            { id: 'pin', label: session.pinned ? 'Відкріпити' : 'Закріпити' },
          ]}
          onAction={(action) => {
            if (action.id === 'delete') void removeSession(session);
            if (action.id === 'pin') void togglePin(session, !session.pinned);
          }}
        >
          {row}
        </SwipeRow>
      </SessionCard>
    );
  });

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="flex items-center justify-between gap-2 px-3 py-3">
        <span className="u-label">розмови</span>
        <Button variant="ghost" size="icon-sm" onClick={onNew} aria-label="Нова розмова">
          <Plus />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden pb-2">
        {loading ? (
          <SkeletonList rows={6} className="px-3" />
        ) : sessions.length === 0 ? (
          <Empty title="Порожньо" hint="Напиши боту — розмова збережеться сама." />
        ) : (
          <AnimatedList
            items={items}
            showGradients
            /*
             * Навігацію стрілками вимкнено свідомо. Вона вішає слухач на
             * WINDOW і перехоплює Enter, Tab і стрілки по всій сторінці —
             * тобто Enter у полі вводу чату «відкривав» виділену розмову й
             * підміняв щойно надіслане повідомлення старою історією.
             * У списку поруч із текстовим полем це неприйнятно.
             */
            enableArrowNavigation={false}
            displayScrollbar
            initialSelectedIndex={Math.max(0, sessions.findIndex((s) => s.id === current))}
            onItemSelect={(_item, index) => {
              const session = sessions[index];
              if (session) onOpen(session.id);
            }}
            className="h-full"
          />
        )}
      </div>
    </div>
  );
}
