import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, File, Folder, FolderOpen, RotateCw, Save } from 'lucide-react';
import { Panel, PanelHead } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Empty, SkeletonList } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toaster';
import { CodeEditor } from '@/components/editor/CodeEditor';
import { get, post } from '@/lib/api';
import { cn } from '@/lib/cn';
import { glue } from '@/lib/glue';
import { useIsDesk } from '@/hooks/useMediaQuery';
import { useRouteParam } from '@/app/useRoute';

/*
 * Робоча тека бота.
 *
 * Тека вантажиться лінькувато, по кліку: бот кладе сюди все, що завантажив і
 * згенерував, і рекурсивне дерево на старті було б і повільним, і марним —
 * дивляться зазвичай у дві-три теки.
 */

interface Entry {
  name: string;
  path: string;
  type: 'dir' | 'file';
  size: number;
  mtime: number;
}

interface FileData {
  path: string;
  size: number;
  binary?: boolean;
  too_large?: boolean;
  content: string;
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

export default function FilesPanel() {
  const isDesk = useIsDesk();
  const toast = useToast();
  const client = useQueryClient();
  const requestedPath = useRouteParam('path');

  const [dir, setDir] = useState('');
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!requestedPath) return;
    setOpenPath(requestedPath);
    const slash = requestedPath.lastIndexOf('/');
    setDir(slash > 0 ? requestedPath.slice(0, slash) : '');
  }, [requestedPath]);

  const listing = useQuery({
    queryKey: ['workspace', dir],
    queryFn: () => get<{ path: string; entries: Entry[] }>(`/api/workspace/list?path=${encodeURIComponent(dir)}`),
  });

  const file = useQuery({
    queryKey: ['workspace-file', openPath],
    queryFn: () => get<FileData>(`/api/workspace/file?path=${encodeURIComponent(openPath!)}`),
    enabled: !!openPath,
  });

  // Чернетку скидаємо ЛИШЕ коли приїхав інший файл: інакше кожне
  // перезавантаження запиту стирало б незбережені правки.
  useEffect(() => {
    if (file.data) {
      setDraft(file.data.content ?? '');
      setDirty(false);
    }
  }, [file.data]);

  const save = useCallback(async () => {
    if (!openPath) return;
    try {
      await post('/api/workspace/file', { path: openPath, content: draft });
      setDirty(false);
      toast.ok('Збережено', openPath);
      void client.invalidateQueries({ queryKey: ['workspace', dir] });
    } catch (error) {
      toast.error('Не вдалося зберегти', (error as Error).message);
    }
  }, [client, dir, draft, openPath, toast]);

  // Ctrl/Cmd+S — очікувана дія в будь-якому редакторі; без неї правку легко
  // загубити, перемкнувши файл.
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

  const crumbs = dir ? dir.split('/') : [];

  const browser = (
    <div className="flex min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1 px-3 py-3 text-[12px]">
        <button
          type="button"
          onClick={() => setDir('')}
          className={cn('rounded-xs px-1 py-0.5 hover:bg-surface-2', dir ? 'text-ink-2' : 'text-ink')}
        >
          тека бота
        </button>
        {crumbs.map((part, index) => (
          <span key={index} className="flex items-center gap-1">
            <ChevronRight className="size-3 text-ink-3" />
            <button
              type="button"
              onClick={() => setDir(crumbs.slice(0, index + 1).join('/'))}
              className={cn(
                'rounded-xs px-1 py-0.5 hover:bg-surface-2',
                index === crumbs.length - 1 ? 'text-ink' : 'text-ink-2',
              )}
            >
              {part}
            </button>
          </span>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {listing.isPending ? (
          <SkeletonList rows={8} className="px-1" />
        ) : listing.isError ? (
          <Empty title="Тека недоступна" hint={(listing.error as Error).message} />
        ) : listing.data?.entries.length === 0 ? (
          <Empty icon={FolderOpen} title="Порожня тека" />
        ) : (
          <ul className="space-y-0.5">
            {listing.data?.entries.map((entry) => {
              const active = entry.path === openPath;
              const Icon = entry.type === 'dir' ? Folder : File;
              return (
                <li key={entry.path}>
                  <button
                    type="button"
                    onClick={() => (entry.type === 'dir' ? setDir(entry.path) : setOpenPath(entry.path))}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left transition-colors',
                      active ? 'bg-accent-soft' : 'hover:bg-surface-2',
                    )}
                  >
                    <Icon
                      className="size-4 shrink-0 text-ink-3"
                      strokeWidth={1.75}
                      style={entry.type === 'dir' ? { color: 'var(--c-accent)' } : undefined}
                    />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{entry.name}</span>
                    {entry.type === 'file' ? (
                      <span className="u-data shrink-0 text-[10px] text-ink-3">{humanSize(entry.size)}</span>
                    ) : null}
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
      {!openPath ? (
        <Empty
          icon={File}
          title="Файл не вибрано"
          hint={glue('Обери файл ліворуч — текстові відкриються в редакторі.')}
        />
      ) : file.isPending ? (
        <div className="p-4">
          <SkeletonList rows={10} />
        </div>
      ) : file.isError ? (
        <Empty title="Не вдалося відкрити" hint={(file.error as Error).message} />
      ) : file.data?.binary ? (
        <Empty title="Двійковий файл" hint={glue('Показати як текст не вийде. Розмір: ') + humanSize(file.data.size)} />
      ) : file.data?.too_large ? (
        <Empty title="Завеликий файл" hint={glue('Редактор його не відкриє. Розмір: ') + humanSize(file.data.size)} />
      ) : (
        <>
          <div className="shrink-0 border-b border-line px-3 py-2">
            <PanelHead
              className="mb-0"
              label={openPath.split('/').pop() ?? ''}
              hint={dirty ? 'незбережено' : humanSize(file.data?.size ?? 0)}
              actions={
                <>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Перечитати"
                    onClick={() => void file.refetch()}
                  >
                    <RotateCw />
                  </Button>
                  <Button variant={dirty ? 'solid' : 'ghost'} size="sm" disabled={!dirty} onClick={() => void save()}>
                    <Save />
                    Зберегти
                  </Button>
                </>
              }
            />
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <CodeEditor
              path={openPath}
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
        {openPath ? (
          <>
            <Button variant="ghost" size="sm" className="self-start" onClick={() => setOpenPath(null)}>
              ← До списку
            </Button>
            {editor}
          </>
        ) : (
          <Panel flush className="min-h-0 flex-1">
            {browser}
          </Panel>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="w-[280px] shrink-0 border-r border-line bg-surface">{browser}</aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col p-4">{editor}</div>
    </div>
  );
}
