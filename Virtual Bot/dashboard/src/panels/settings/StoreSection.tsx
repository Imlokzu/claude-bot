import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Download, Search } from 'lucide-react';
import { Panel, PanelHead } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { Empty, ErrorNote, SkeletonList } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toaster';
import { get, post } from '@/lib/api';
import { glue } from '@/lib/glue';
import type { StoreCatalog } from './types';

/*
 * Магазин умінь: скіли ClawHub і MCP-сервери з курованого каталогу.
 *
 * Пошук навмисно не миттєвий, а по кнопці/Enter: за ним стоїть виклик
 * `openclaw skills search`, тобто запуск процесу — дьоргати його на кожну
 * натиснуту літеру не можна.
 */

type Kind = 'all' | 'skills' | 'mcp';

export function StoreSection() {
  const toast = useToast();
  const client = useQueryClient();
  const [kind, setKind] = useState<Kind>('all');
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const catalog = useQuery({
    queryKey: ['store', kind, query],
    queryFn: () =>
      get<StoreCatalog>(`/api/store?kind=${kind}&query=${encodeURIComponent(query)}`),
  });

  const install = async (what: 'skill' | 'mcp', id: string) => {
    setBusy(id);
    try {
      if (what === 'skill') await post('/api/store/skills/install', { slug: id });
      else await post('/api/store/mcp/install', { id, env: {} });
      toast.ok('Встановлено', id);
      void client.invalidateQueries({ queryKey: ['store'] });
    } catch (error) {
      toast.error('Не вдалося встановити', (error as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const skills = catalog.data?.skills ?? [];
  const mcp = catalog.data?.mcp ?? [];
  const empty = !catalog.isPending && skills.length === 0 && mcp.length === 0;

  return (
    <Panel className="space-y-4">
      <PanelHead label="уміння" hint={glue('Скіли ClawHub і MCP-сервери')} />

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(input);
        }}
      >
        <Input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Наприклад: календар, погода, браузер"
        />
        <Button type="submit" variant="outline" size="icon" aria-label="Знайти">
          <Search />
        </Button>
      </form>

      <Segmented
        ariaLabel="Тип розширення"
        value={kind}
        onChange={setKind}
        items={[
          { value: 'all', label: 'Усе' },
          { value: 'skills', label: 'Скіли' },
          { value: 'mcp', label: 'MCP' },
        ]}
      />

      {catalog.data?.openclaw && !catalog.data.openclaw.available ? (
        <ErrorNote message={glue('OpenClaw не знайдено в системі — скіли встановити не вийде.')} />
      ) : null}

      {Object.entries(catalog.data?.errors ?? {}).map(([where, message]) => (
        <ErrorNote key={where} message={`${where}: ${message}`} />
      ))}

      {catalog.isPending ? (
        <SkeletonList rows={5} />
      ) : empty ? (
        <Empty title="Нічого не знайшлось" hint={glue('Спробуй інший запит або інший тип.')} />
      ) : (
        <div className="space-y-5">
          {skills.length > 0 ? (
            <section>
              <p className="u-label mb-2">скіли</p>
              <ul className="divide-y divide-line">
                {skills.map((item) => (
                  <li key={item.slug} className="flex items-start gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] text-ink">{item.name || item.slug}</p>
                      {item.description ? (
                        <p className="mt-0.5 text-[12px] leading-snug text-ink-3">{item.description}</p>
                      ) : null}
                    </div>
                    <InstallButton
                      installed={!!item.installed}
                      busy={busy === item.slug}
                      onClick={() => void install('skill', item.slug)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {mcp.length > 0 ? (
            <section>
              <p className="u-label mb-2">mcp-сервери</p>
              <ul className="divide-y divide-line">
                {mcp.map((item) => (
                  <li key={item.id} className="flex items-start gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] text-ink">{item.label || item.name || item.id}</p>
                      {item.description || item.hint ? (
                        <p className="mt-0.5 text-[12px] leading-snug text-ink-3">
                          {item.description || item.hint}
                        </p>
                      ) : null}
                    </div>
                    <InstallButton
                      installed={!!item.installed}
                      busy={busy === item.id}
                      onClick={() => void install('mcp', item.id)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </Panel>
  );
}

function InstallButton({
  installed,
  busy,
  onClick,
}: {
  installed: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  if (installed) {
    return (
      <span className="flex shrink-0 items-center gap-1.5 py-1.5 text-[12px] text-ok">
        <Check className="size-3.5" />
        Стоїть
      </span>
    );
  }
  return (
    <Button size="sm" variant="outline" disabled={busy} onClick={onClick} className="shrink-0">
      <Download />
      {busy ? 'Ставлю…' : 'Поставити'}
    </Button>
  );
}
