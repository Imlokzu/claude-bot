import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Brain, Plus, Save, Trash2 } from 'lucide-react';
import { Panel, PanelHead } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Empty, SkeletonList } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toaster';
import { NoteEditor } from '@/components/editor/NoteEditor';
import { FuseButton } from '@/vendor/reactbits';
import { useCssVar } from '@/hooks/useAccentRgb';
import { get, post } from '@/lib/api';
import { cn } from '@/lib/cn';
import { glue } from '@/lib/glue';
import { useIsDesk } from '@/hooks/useMediaQuery';

/*
 * Памʼять бота — тека brain/ з markdown-нотатками.
 *
 * Ті самі файли читає й переписує сам бот, тож редактор мусить зберігати
 * саме Markdown (див. NoteEditor). Це не «нотатки користувача», а спільний
 * із ботом простір: правку тут він побачить наступною реплікою.
 */

interface Note {
  path: string;
  title: string;
}

export default function MemoryPanel() {
  const isDesk = useIsDesk();
  const toast = useToast();
  const client = useQueryClient();

  const [current, setCurrent] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [dirty, setDirty] = useState(false);
  const [filter, setFilter] = useState('');

  const surface2 = useCssVar('--c-surface-2', '#efe9df');
  const ink = useCssVar('--c-text', '#231e19');
  const err = useCssVar('--c-err', '#b2412e');

  const notes = useQuery({
    queryKey: ['memory-notes'],
    queryFn: async () => (await get<{ files: Note[] }>('/api/memory/list')).files ?? [],
  });

  const note = useQuery({
    queryKey: ['memory-note', current],
    queryFn: () => get<{ path: string; content: string }>(`/api/memory/file?path=${encodeURIComponent(current!)}`),
    enabled: !!current,
  });

  useEffect(() => {
    if (note.data) {
      setDraft(note.data.content ?? '');
      setDirty(false);
    }
  }, [note.data]);

  const save = useCallback(async () => {
    if (!current) return;
    try {
      await post('/api/memory/save', { path: current, content: draft });
      setDirty(false);
      toast.ok('Записано в памʼять', current);
      void client.invalidateQueries({ queryKey: ['memory-notes'] });
    } catch (error) {
      toast.error('Не вдалося зберегти', (error as Error).message);
    }
  }, [client, current, draft, toast]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 's') {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  const removeNote = async () => {
    if (!current) return;
    try {
      // Окремого DELETE для нотаток бекенд не має, тож «видалення» — це
      // порожній вміст: файл лишається, але памʼять очищується. Чесно
      // кажемо про це в підказці нижче.
      await post('/api/memory/save', { path: current, content: '' });
      void client.invalidateQueries({ queryKey: ['memory-notes'] });
      setDraft('');
      toast.ok('Нотатку очищено', current);
    } catch (error) {
      toast.error('Не вдалося очистити', (error as Error).message);
    }
  };

  const createNote = async () => {
    const name = window.prompt('Назва нотатки (без .md)');
    if (!name) return;
    const path = `${name.replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s+/g, '-')}.md`;
    try {
      await post('/api/memory/save', { path, content: `# ${name}\n\n` });
      await client.invalidateQueries({ queryKey: ['memory-notes'] });
      setCurrent(path);
    } catch (error) {
      toast.error('Не вдалося створити', (error as Error).message);
    }
  };

  const shown = (notes.data ?? []).filter((item) => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return true;
    return item.title.toLowerCase().includes(needle) || item.path.toLowerCase().includes(needle);
  });

  const list = (
    <div className="flex min-h-0 flex-col">
      <div className="shrink-0 space-y-2 px-3 py-3">
        <PanelHead
          className="mb-0"
          label="нотатки"
          hint={`${shown.length}`}
          actions={
            <Button variant="ghost" size="icon-sm" aria-label="Нова нотатка" onClick={() => void createNote()}>
              <Plus />
            </Button>
          }
        />
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Пошук…"
          className="h-8 text-[13px]"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {notes.isPending ? (
          <SkeletonList rows={8} className="px-1" />
        ) : shown.length === 0 ? (
          <Empty icon={Brain} title="Порожньо" hint={glue('Бот запише сюди те, що варто памʼятати.')} />
        ) : (
          <ul className="space-y-0.5">
            {shown.map((item) => {
              const active = item.path === current;
              return (
                <li key={item.path}>
                  <button
                    type="button"
                    onClick={() => setCurrent(item.path)}
                    className={cn(
                      'w-full rounded-md px-2.5 py-2 text-left transition-colors',
                      active ? 'bg-accent-soft' : 'hover:bg-surface-2',
                    )}
                  >
                    <span className="block truncate text-[13px] text-ink">{item.title || item.path}</span>
                    <span className="u-data block truncate text-[10px] text-ink-3">{item.path}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );

  const editor = (
    <Panel flush className="min-h-0 flex-1 overflow-hidden">
      {!current ? (
        <Empty icon={Brain} title="Нотатку не вибрано" hint={glue('Обери нотатку ліворуч або створи нову.')} />
      ) : note.isPending ? (
        <div className="p-4">
          <SkeletonList rows={10} />
        </div>
      ) : note.isError ? (
        <Empty title="Не вдалося відкрити" hint={(note.error as Error).message} />
      ) : (
        <>
          <div className="shrink-0 border-b border-line px-3 py-2">
            <PanelHead
              className="mb-0"
              label={current}
              hint={dirty ? 'незбережено' : 'збережено'}
              actions={
                <>
                  {/* Видалення з ґнотом: кілька секунд на «Відмінити» замість
                      модального «ви впевнені?». Нотатки памʼяті пише сам бот,
                      і помилково стерта — це втрачений факт про людину. */}
                  <FuseButton
                    label="Видалити"
                    undoLabel="Відмінити"
                    doneLabel="Видалено"
                    icon={<Trash2 size={15} />}
                    undoWindow={4500}
                    size="sm"
                    radius={8}
                    background={surface2}
                    color={ink}
                    fuseColor={err}
                    onCommit={() => void removeNote()}
                  />
                  <Button variant={dirty ? 'solid' : 'ghost'} size="sm" disabled={!dirty} onClick={() => void save()}>
                    <Save />
                    Зберегти
                  </Button>
                </>
              }
            />
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <NoteEditor
              key={current}
              value={draft}
              onChange={(next) => {
                setDraft(next);
                setDirty(true);
              }}
            />
          </div>
        </>
      )}
    </Panel>
  );

  if (!isDesk) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        {current ? (
          <>
            <Button variant="ghost" size="sm" className="self-start" onClick={() => setCurrent(null)}>
              ← До нотаток
            </Button>
            {editor}
          </>
        ) : (
          <Panel flush className="min-h-0 flex-1">
            {list}
          </Panel>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="w-[260px] shrink-0 border-r border-line bg-surface">{list}</aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col p-4">{editor}</div>
    </div>
  );
}
