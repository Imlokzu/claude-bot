import { useQuery } from '@tanstack/react-query';
import { FolderFloat } from '@/vendor/reactbits';
import { useCssVar } from '@/hooks/useAccentRgb';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { get } from '@/lib/api';

/*
 * Проєкти — теки, у які складені розмови.
 *
 * Той самий жест, що й у пакетів: теку відкриваєш, і вміст висипається. Вибір
 * проєкту веде в чат, показуючи саме його розмови (`#/chat?project=<id>`), —
 * тобто тека справді відкривається, а не просто гарно ворушиться.
 */

interface Project {
  id: string;
  name: string;
}

export function ProjectsTile() {
  const folder = useCssVar('--c-surface-3', '#e5ddd0');
  const front = useCssVar('--c-accent-soft', '#f2ddd4');
  const paper = useCssVar('--c-surface', '#fffdf8');
  const ink = useCssVar('--c-text', '#231e19');
  const ink2 = useCssVar('--c-text-2', '#6a6056');
  const finePointer = useMediaQuery('(hover: hover) and (pointer: fine)');

  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => get<{ projects: Project[] }>('/api/projects'),
    staleTime: 60_000,
  });

  const list = projects.data?.projects ?? [];
  const items = list.map((project) => ({ label: project.name || project.id, value: project.id }));

  return (
    <div className="flex min-h-0 flex-1 items-end justify-center pb-1">
      {items.length === 0 ? (
        <p className="text-[13px] text-ink-3">
          {projects.isPending ? 'дивлюсь…' : 'проєктів ще немає'}
        </p>
      ) : (
        <FolderFloat
          items={items}
          label="Проєкти"
          sublabel={`${list.length} ${list.length === 1 ? 'проєкт' : 'проєкти'}`}
          trigger={finePointer ? 'hover' : 'click'}
          width={140}
          height={96}
          spread={118}
          lift={18}
          folderColor={folder}
          frontColor={front}
          paperColor={paper}
          itemColor={paper}
          itemTextColor={ink}
          labelColor={ink2}
          onSelect={(item: { value?: string }) => {
            if (!item?.value) return;
            window.location.hash = `#/chat?project=${encodeURIComponent(item.value)}`;
          }}
        />
      )}
    </div>
  );
}
