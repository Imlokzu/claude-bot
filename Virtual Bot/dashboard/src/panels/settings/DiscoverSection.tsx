import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Check, Download, ExternalLink, Search } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { Empty, ErrorNote, SkeletonList } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toaster';
import { get, post } from '@/lib/api';
import { glue } from '@/lib/glue';
import { t } from '@/locales/extensions';
import { Badge, EXTENSIONS_KEY, Labelled, useExtensions } from './McpSection';
import { SettingGroup } from './SettingRow';
import type { CatalogItem, CatalogResult, CatalogSource, InstallPlan, PlanField } from './types';

/*
 * Public catalogs of MCP servers and skills.
 *
 * Search runs on Enter or the button, not per keystroke: behind ClawHub is
 * an `openclaw skills search` process, and behind the others a request to a
 * public API with its own rate limit.
 *
 * Installing an MCP server opens a dialog built from the install plan, the
 * backend's reading of the catalog entry. The dialog only collects values:
 * the command, the URL and which variables may be set all come from the
 * catalog on the server side, never from this page.
 */

const SOURCES: CatalogSource[] = ['mcp-registry', 'smithery', 'clawhub', 'skills-sh'];

export function DiscoverSection() {
  const toast = useToast();
  const client = useQueryClient();
  const installed = useExtensions();
  const [source, setSource] = useState<CatalogSource>('smithery');
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<CatalogItem | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(() => new Set());

  const needsQuery = source === 'skills-sh' && query.trim().length < 2;
  const results = useQuery({
    queryKey: ['ext-browse', source, query],
    queryFn: () =>
      get<CatalogResult>(
        `/api/extensions/browse?source=${source}&query=${encodeURIComponent(query)}&limit=24`,
      ),
    enabled: !needsQuery,
    staleTime: 60_000,
  });

  const installedMcp = new Set((installed.data?.mcp ?? []).map((server) => server.name));

  const installSkill = async (item: CatalogItem) => {
    setBusy(item.id);
    try {
      await post('/api/extensions/install', { source: item.source, id: item.id });
      toast.ok(t('ext.discover.installed', { name: item.name }));
      setDone((current) => new Set(current).add(`${item.source}:${item.id}`));
      void client.invalidateQueries({ queryKey: EXTENSIONS_KEY });
    } catch (error) {
      toast.error(t('ext.failed'), (error as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const items = results.data?.items ?? [];

  return (
    <div className="space-y-4">
      <p className="max-w-[520px] text-[12px] leading-snug text-ink-3">{glue(t('ext.discover.hint'))}</p>

      <div className="space-y-2">
        <Segmented
          ariaLabel={t('ext.discover.source')}
          value={source}
          onChange={(next) => setSource(next)}
          items={SOURCES.map((id) => ({ value: id, label: t(`ext.discover.src.${id}`) }))}
        />
        <p className="px-1 text-[11.5px] text-ink-3">{glue(t(`ext.discover.srcHint.${source}`))}</p>
      </div>

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(input.trim());
        }}
      >
        <Input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={t('ext.discover.placeholder')}
          aria-label={t('ext.discover.search')}
        />
        <Button type="submit" variant="outline" size="icon" aria-label={t('ext.discover.searchButton')}>
          <Search />
        </Button>
      </form>

      {needsQuery ? (
        <Empty title={t('ext.discover.search')} hint={glue(t('ext.discover.needQuery'))} />
      ) : results.isPending ? (
        <SettingGroup><div className="p-4"><SkeletonList rows={6} /></div></SettingGroup>
      ) : results.isError ? (
        <ErrorNote message={(results.error as Error).message} onRetry={() => void results.refetch()} />
      ) : items.length === 0 ? (
        <Empty title={t('ext.discover.empty')} hint={glue(t('ext.discover.emptyHint'))} />
      ) : (
        <SettingGroup>
          <ul className="divide-y divide-line">
            {items.map((item) => {
              const key = `${item.source}:${item.id}`;
              const have = done.has(key) || (item.kind === 'mcp' && installedMcp.has(suggestName(item.id)));
              return (
                <li key={key} className="flex items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-[13px] text-ink">
                      <span>{item.name}</span>
                      {item.verified ? (
                        <BadgeCheck className="size-3.5 text-accent" strokeWidth={1.75} aria-label={t('ext.discover.verified')} />
                      ) : null}
                      {item.via ? <Badge>{item.via}</Badge> : null}
                      {!item.installable ? <Badge>{t('ext.discover.notInstallable')}</Badge> : null}
                    </p>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-ink-3" title={item.id}>{item.id}</p>
                    {item.description ? (
                      <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-ink-2">{item.description}</p>
                    ) : null}
                    {item.popularity ? (
                      <p className="mt-0.5 text-[11px] text-ink-3">
                        {t('ext.discover.uses', { count: item.popularity.toLocaleString() })}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {item.homepage ? (
                      <Button asChild size="icon-sm" variant="ghost">
                        <a href={item.homepage} target="_blank" rel="noreferrer" aria-label={t('ext.discover.open')}>
                          <ExternalLink />
                        </a>
                      </Button>
                    ) : null}
                    {have ? (
                      <span className="flex items-center gap-1.5 px-2 text-[12px] text-ok">
                        <Check className="size-3.5" />
                      </span>
                    ) : item.installable ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === item.id}
                        onClick={() => (item.kind === 'skill' ? void installSkill(item) : setPicked(item))}
                      >
                        <Download />
                        {busy === item.id ? t('ext.discover.installing') : t('ext.discover.install')}
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </SettingGroup>
      )}

      <Dialog open={picked !== null} onOpenChange={(open) => (open ? null : setPicked(null))}>
        {picked ? (
          <InstallDialog
            item={picked}
            onDone={() => {
              setDone((current) => new Set(current).add(`${picked.source}:${picked.id}`));
              setPicked(null);
              void client.invalidateQueries({ queryKey: EXTENSIONS_KEY });
              void client.invalidateQueries({ queryKey: ['tools-catalog'] });
            }}
          />
        ) : null}
      </Dialog>
    </div>
  );
}

/** Mirror of extension_registries.suggest_name, to mark what is already there. */
function suggestName(raw: string): string {
  const tail = raw.trim().split('/').pop()?.replace(/^@/, '') ?? '';
  const name = tail.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[-_]+|[-_]+$/g, '');
  return (name || 'server').slice(0, 48);
}

function InstallDialog({ item, onDone }: { item: CatalogItem; onDone: () => void }) {
  const toast = useToast();
  const plan = useQuery({
    queryKey: ['ext-plan', item.source, item.id],
    queryFn: () =>
      get<InstallPlan>(
        `/api/extensions/browse/plan?source=${item.source}&id=${encodeURIComponent(item.id)}`,
      ),
  });
  const [name, setName] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!plan.data) return;
    setName(plan.data.name ?? '');
    const defaults: Record<string, string> = {};
    for (const field of [...(plan.data.env ?? []), ...(plan.data.headers ?? [])]) {
      if (field.default) defaults[field.name] = field.default;
    }
    setValues(defaults);
  }, [plan.data]);

  const env = plan.data?.env ?? [];
  const headers = plan.data?.headers ?? [];

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const missing = [...env, ...headers].filter((field) => field.required && !values[field.name]?.trim());
    if (missing.length > 0) {
      toast.error(t('ext.failed'), t('ext.plan.missing', { names: missing.map((field) => field.name).join(', ') }));
      return;
    }
    const pick = (fields: PlanField[]) =>
      Object.fromEntries(fields.filter((field) => values[field.name]).map((field) => [field.name, values[field.name]]));
    setBusy(true);
    try {
      await post('/api/extensions/install', {
        source: item.source,
        id: item.id,
        name: name.trim(),
        env: pick(env),
        headers: pick(headers),
      });
      toast.ok(t('ext.discover.installed', { name: item.name }));
      onDone();
    } catch (error) {
      toast.error(t('ext.failed'), (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const launch = plan.data
    ? plan.data.url ?? [plan.data.command, ...(plan.data.args ?? [])].filter(Boolean).join(' ')
    : '';

  return (
    <DialogContent title={t('ext.plan.title', { name: item.name })} description={glue(t('ext.form.description'))}>
      {plan.isPending ? (
        <div className="space-y-3">
          <p className="text-[12px] text-ink-3">{t('ext.plan.loading')}</p>
          <SkeletonList rows={3} />
        </div>
      ) : plan.isError ? (
        <ErrorNote message={(plan.error as Error).message} onRetry={() => void plan.refetch()} />
      ) : (
        <form className="space-y-4" onSubmit={(event) => void submit(event)}>
          <Labelled label={t('ext.plan.via')}>
            <p className="break-all rounded-md border border-line bg-surface-2 px-3 py-2 font-mono text-[11.5px] text-ink-2">
              {launch}
            </p>
          </Labelled>
          <Labelled label={t('ext.plan.name')} hint={t('ext.form.nameHint')} htmlFor="plan-name">
            <Input
              id="plan-name"
              required
              pattern="[A-Za-z0-9][A-Za-z0-9_\-]{0,47}"
              className="font-mono"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Labelled>
          {[...env, ...headers].length === 0 ? (
            <p className="text-[12px] text-ink-3">{t('ext.plan.noValues')}</p>
          ) : (
            [...env, ...headers].map((field) => (
              <Labelled
                key={field.name}
                label={`${field.name}${field.required ? ` · ${t('ext.plan.required')}` : ''}`}
                hint={field.description || undefined}
                htmlFor={`plan-${field.name}`}
              >
                <Input
                  id={`plan-${field.name}`}
                  type={field.secret ? 'password' : 'text'}
                  autoComplete="off"
                  className="font-mono"
                  placeholder={field.template || undefined}
                  value={values[field.name] ?? ''}
                  onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
                />
              </Labelled>
            ))
          )}
          <div className="flex justify-end">
            <Button type="submit" variant="solid" disabled={busy}>
              {busy ? t('ext.form.busy') : t('ext.plan.submit')}
            </Button>
          </div>
        </form>
      )}
    </DialogContent>
  );
}
