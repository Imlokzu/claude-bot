import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { FileText, Image as ImageIcon, RefreshCw, Save, X } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Empty, SkeletonList } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toaster';
import { useBotEvents } from '@/hooks/useBotEvents';
import { get, post } from '@/lib/api';
import { t } from '@/lib/i18n';

interface FileData {
  path: string;
  size: number;
  binary?: boolean;
  too_large?: boolean;
  content: string;
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico']);
const HTML_EXTENSIONS = new Set(['html', 'htm']);
const CodeEditor = lazy(() => import('@/components/editor/CodeEditor').then(({ CodeEditor: Editor }) => ({ default: Editor })));

function extension(path: string): string {
  return path.split('.').pop()?.toLowerCase() ?? '';
}

function previewUrl(path: string): string {
  return `/preview/${path.split('/').map(encodeURIComponent).join('/')}`;
}

export function WorkspacePreviewDock() {
  const [path, setPath] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [dirty, setDirty] = useState(false);
  const client = useQueryClient();
  const toast = useToast();

  useBotEvents((event) => {
    if (event.type !== 'preview') return;
    const next = String(event.path || '').trim();
    if (!next) return;
    setPath(next);
    setDirty(false);
  });

  const ext = useMemo(() => (path ? extension(path) : ''), [path]);
  const isImage = IMAGE_EXTENSIONS.has(ext);
  const isHtml = HTML_EXTENSIONS.has(ext);
  const file = useQuery({
    queryKey: ['workspace-preview', path],
    queryFn: () => get<FileData>(`/api/workspace/file?path=${encodeURIComponent(path!)}`),
    enabled: Boolean(path) && !isImage && !isHtml,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (file.data && !file.data.binary) {
      setDraft(file.data.content ?? '');
      setDirty(false);
    }
  }, [file.data]);

  if (!path) return null;

  const save = async () => {
    try {
      await post('/api/workspace/file', { path, content: draft });
      setDirty(false);
      toast.ok(t('workspace.saved'), path);
      void client.invalidateQueries({ queryKey: ['workspace-preview', path] });
    } catch (error) {
      toast.error(t('workspace.saveError'), (error as Error).message);
    }
  };

  const title = path.split('/').pop() || path;
  const canEdit = !isImage && !isHtml && !file.data?.binary && !file.data?.too_large;

  return (
    <aside
      className="pointer-events-none fixed inset-x-3 bottom-16 top-16 z-[var(--z-modal)] flex justify-end sm:inset-x-auto sm:right-3 sm:w-[min(440px,calc(100vw-24px))]"
      aria-label={t('workspace.preview')}
    >
      <section className="pointer-events-auto flex min-h-0 w-full flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-pop u-pop">
        <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2.5">
          {isImage ? <ImageIcon className="size-4 text-accent" /> : <FileText className="size-4 text-accent" />}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-ink">{title}</p>
            <p className="truncate font-mono text-[10px] text-ink-3">{path}</p>
          </div>
          {dirty ? <span className="text-[10px] text-accent">{t('workspace.unsaved')}</span> : null}
          {canEdit ? (
            <Button variant={dirty ? 'solid' : 'ghost'} size="icon-sm" disabled={!dirty} onClick={() => void save()} aria-label={t('workspace.save')}>
              <Save />
            </Button>
          ) : null}
          {!isImage && !isHtml ? (
            <Button variant="ghost" size="icon-sm" onClick={() => void file.refetch()} aria-label={t('workspace.reload')}>
              <RefreshCw />
            </Button>
          ) : null}
          <Button variant="ghost" size="icon-sm" onClick={() => setPath(null)} aria-label={t('workspace.close')}>
            <X />
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-hidden">
          {isImage ? (
            <div className="flex h-full items-center justify-center overflow-auto bg-bg p-4">
              <img src={previewUrl(path)} alt={title} className="max-h-full max-w-full object-contain" />
            </div>
          ) : isHtml ? (
            <iframe title={title} src={previewUrl(path)} sandbox="allow-scripts" className="size-full border-0 bg-white" />
          ) : file.isPending ? (
            <div className="p-4"><SkeletonList rows={9} /></div>
          ) : file.isError ? (
            <Empty title={t('workspace.openError')} hint={(file.error as Error).message} />
          ) : file.data?.binary ? (
            <Empty title={t('workspace.binary')} hint={t('workspace.binaryHint')} />
          ) : file.data?.too_large ? (
            <Empty title={t('workspace.tooLarge')} hint={t('workspace.tooLargeHint')} />
          ) : (
            <Suspense fallback={<div className="p-4"><SkeletonList rows={9} /></div>}>
              <CodeEditor path={path} value={draft} onChange={(next) => { setDraft(next); setDirty(true); }} />
            </Suspense>
          )}
        </div>
      </section>
    </aside>
  );
}
