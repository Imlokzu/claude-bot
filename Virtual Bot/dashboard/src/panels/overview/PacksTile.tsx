import { useQuery } from '@tanstack/react-query';
import { FolderFloat } from '@/vendor/reactbits';
import { useCssVar } from '@/hooks/useAccentRgb';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { get } from '@/lib/api';

/*
 * Пакети екрана — теки, з якої вилітають встановлені застосунки.
 *
 * FolderFloat (React Bits): вміст справді «висипається» з теки й тримається
 * на фізиці Matter.js, його можна розкидати пальцем. Для магазину це рівно
 * той жест, який має бути: пакети — речі, які кладуть у пристрій і дістають
 * назад, а не рядки списку.
 *
 * Вибір пакета відкриває сам застосунок (/store-apps/<id>/index.html) —
 * тобто те саме, що показує екран бота.
 */

interface Pack {
  id: string;
  label?: string;
  entry?: string;
}

export function PacksTile() {
  const folder = useCssVar('--c-surface-3', '#e5ddd0');
  const front = useCssVar('--c-accent-soft', '#f2ddd4');
  const paper = useCssVar('--c-surface', '#fffdf8');
  const ink = useCssVar('--c-text', '#231e19');
  const ink2 = useCssVar('--c-text-2', '#6a6056');
  const finePointer = useMediaQuery('(hover: hover) and (pointer: fine)');

  const installed = useQuery({
    queryKey: ['screen-store-installed'],
    queryFn: () => get<{ apps: Pack[]; skins: Pack[] }>('/api/screen-store/installed'),
    staleTime: 60_000,
  });

  const apps = installed.data?.apps ?? [];
  const items = apps.map((app) => ({ label: app.label || app.id, value: app.id }));

  return (
    <div className="flex min-h-0 flex-1 items-end justify-center pb-1">
      {items.length === 0 ? (
        <p className="text-[13px] text-ink-3">
          {installed.isPending ? 'дивлюсь…' : 'пакетів ще не встановлено'}
        </p>
      ) : (
        <FolderFloat
          items={items}
          label="Пакети екрана"
          sublabel={`${apps.length} ${apps.length === 1 ? 'застосунок' : 'застосунки'}`}
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
            window.open(`/store-apps/${encodeURIComponent(item.value)}/index.html`, '_blank', 'noopener');
          }}
        />
      )}
    </div>
  );
}
