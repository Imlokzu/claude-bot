import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import { Panel, PanelHead } from '@/components/ui/Panel';
import { SwitchRow } from '@/components/ui/Switch';
import { ErrorNote, SkeletonList } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toaster';
import { get, post } from '@/lib/api';
import { glue } from '@/lib/glue';
import { t } from '@/lib/i18n';

/*
 * Доступ до інструментів.
 *
 * Тут видно те, що інакше виглядає як поламаний бот: OpenClaw тримає
 * профіль `minimal` і власний білий список, тож інструмент може бути
 * оголошений мостом, працювати при прямому виклику — і все одно не
 * доходити до агента. Панель показує обидва боки й перемикає дозвіл.
 *
 * Перемикач одразу пише в конфіг шлюзу, тож на ті інструменти, що діють
 * поза цією машиною, спершу питаємо підтвердження: випадкове влучання
 * не має тихо дозволяти публікацію чи видалення.
 */

interface ToolItem {
  name: string;
  qualified: string;
  description: string;
  enabled: boolean;
  sensitive: boolean;
}
interface ToolGroup {
  server: string;
  tools: ToolItem[];
}
interface ToolCatalog {
  profile: string;
  readable: boolean;
  groups: ToolGroup[];
}

const SERVER_LABELS: Record<string, 'tools.serverTools' | 'tools.serverWorkspace' | 'tools.serverEmotions'> = {
  tools: 'tools.serverTools',
  workspace: 'tools.serverWorkspace',
  emotions: 'tools.serverEmotions',
};

export function ToolsSection() {
  const toast = useToast();
  const client = useQueryClient();

  const catalog = useQuery({
    queryKey: ['tools-catalog'],
    queryFn: () => get<ToolCatalog>('/api/tools/catalog'),
    staleTime: 10_000,
  });

  const flip = async (tool: ToolItem, next: boolean) => {
    // Підтвердження лише на ВМИКАННЯ: забрати дозвіл — безпечний бік.
    if (next && tool.sensitive && !window.confirm(t('tools.confirm'))) return;
    try {
      await post('/api/tools/access', { qualified: tool.qualified, enabled: next });
      toast.ok(t('tools.saved'));
      await client.invalidateQueries({ queryKey: ['tools-catalog'] });
    } catch (error) {
      toast.error(t('tools.failed'), (error as Error).message);
    }
  };

  if (catalog.isPending) {
    return (
      <Panel>
        <SkeletonList rows={6} />
      </Panel>
    );
  }
  if (catalog.isError) {
    return <ErrorNote message={(catalog.error as Error).message} onRetry={() => void catalog.refetch()} />;
  }
  if (!catalog.data.readable) {
    return (
      <Panel>
        <p className="text-[13px] text-ink-2">{glue(t('tools.unreadable'))}</p>
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      {catalog.data.groups.map((group) => {
        const on = group.tools.filter((tool) => tool.enabled).length;
        return (
          <Panel key={group.server} className="space-y-1">
            <PanelHead
              label={t(SERVER_LABELS[group.server] ?? 'tools.head')}
              hint={t('tools.enabled', { on, total: group.tools.length })}
            />
            <ul className="divide-y divide-line">
              {group.tools.map((tool) => (
                <li key={tool.qualified}>
                  <SwitchRow
                    label={tool.name}
                    hint={glue(tool.description)}
                    checked={tool.enabled}
                    onChange={(next) => void flip(tool, next)}
                  />
                  {tool.sensitive ? (
                    <p className="flex items-center gap-1.5 pb-2 pl-1 text-[11px] text-ink-3">
                      <ShieldAlert className="size-3.5 shrink-0" />
                      {t('tools.sensitive')}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </Panel>
        );
      })}
      {catalog.data.profile ? (
        <p className="px-1 text-[11.5px] text-ink-3">
          {t('tools.profile', { profile: catalog.data.profile })}
        </p>
      ) : null}
    </div>
  );
}
