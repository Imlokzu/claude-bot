import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Compass, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { Input, Select, Textarea } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { Switch } from '@/components/ui/Switch';
import { Empty, ErrorNote, SkeletonList } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toaster';
import { del, get, post } from '@/lib/api';
import { glue } from '@/lib/glue';
import { t } from '@/locales/extensions';
import { SettingGroup } from './SettingRow';
import type { Extensions, McpServer } from './types';

/*
 * MCP servers, read straight from OpenClaw's mcp.servers.
 *
 * There is no local list to fall out of sync: every switch and every
 * removal is an `openclaw mcp ...` call on the backend, and the list is
 * re-read afterwards. The bot's own bridges are shown apart and read-only,
 * because switching one off would take the crab's face or hands away.
 */

export const EXTENSIONS_KEY = ['extensions'] as const;

export function useExtensions() {
  return useQuery({
    queryKey: EXTENSIONS_KEY,
    queryFn: () => get<Extensions>('/api/extensions'),
    staleTime: 10_000,
  });
}

export function McpSection({ onDiscover }: { onDiscover: () => void }) {
  const toast = useToast();
  const client = useQueryClient();
  const data = useExtensions();
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const refresh = () => {
    void client.invalidateQueries({ queryKey: EXTENSIONS_KEY });
    void client.invalidateQueries({ queryKey: ['tools-catalog'] });
  };

  const toggle = async (server: McpServer, enabled: boolean) => {
    setBusy(server.name);
    try {
      await post(`/api/extensions/mcp/${encodeURIComponent(server.name)}/enabled`, { enabled });
      toast.ok(t('ext.saved'));
      refresh();
    } catch (error) {
      toast.error(t('ext.failed'), (error as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (server: McpServer) => {
    if (!window.confirm(t('ext.mcp.removeConfirm', { name: server.name }))) return;
    setBusy(server.name);
    try {
      await del(`/api/extensions/mcp/${encodeURIComponent(server.name)}`);
      toast.ok(t('ext.mcp.removed'), server.name);
      refresh();
    } catch (error) {
      toast.error(t('ext.failed'), (error as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (data.isPending) {
    return (
      <SettingGroup>
        <div className="p-4"><SkeletonList rows={5} /></div>
      </SettingGroup>
    );
  }
  if (data.isError) {
    return <ErrorNote message={(data.error as Error).message} onRetry={() => void data.refetch()} />;
  }
  if (!data.data.available) {
    return <ErrorNote message={glue(t('ext.unavailable'))} />;
  }

  const own = data.data.mcp.filter((server) => !server.builtin);
  const bridges = data.data.mcp.filter((server) => server.builtin);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[440px] text-[12px] leading-snug text-ink-3">{glue(t('ext.mcp.hint'))}</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={onDiscover}>
            <Compass />
            {t('ext.mcp.discover')}
          </Button>
          <Button size="sm" variant="solid" onClick={() => setAdding(true)}>
            <Plus />
            {t('ext.mcp.add')}
          </Button>
        </div>
      </div>

      <SettingGroup label={t('ext.mcp.head')}>
        {own.length === 0 ? (
          <div className="p-4">
            <Empty title={t('ext.mcp.empty')} hint={glue(t('ext.mcp.emptyHint'))} />
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {own.map((server) => (
              <ServerRow
                key={server.name}
                server={server}
                busy={busy === server.name}
                onToggle={(next) => void toggle(server, next)}
                onRemove={() => void remove(server)}
              />
            ))}
          </ul>
        )}
      </SettingGroup>

      {bridges.length > 0 ? (
        <SettingGroup label={t('ext.mcp.bridges')}>
          <p className="border-b border-line px-4 py-2.5 text-[12px] text-ink-3">{glue(t('ext.mcp.bridgesHint'))}</p>
          <ul className="divide-y divide-line">
            {bridges.map((server) => (
              <ServerRow key={server.name} server={server} busy={false} />
            ))}
          </ul>
        </SettingGroup>
      ) : null}

      <Dialog open={adding} onOpenChange={setAdding}>
        {adding ? (
          <AddServerDialog
            onDone={() => {
              setAdding(false);
              refresh();
            }}
          />
        ) : null}
      </Dialog>
    </div>
  );
}

function ServerRow({
  server,
  busy,
  onToggle,
  onRemove,
}: {
  server: McpServer;
  busy: boolean;
  onToggle?: (next: boolean) => void;
  onRemove?: () => void;
}) {
  const keys = [...server.env_keys, ...server.header_keys].filter((key) => key !== 'VBOT_URL');
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-[13px] text-ink">
          <span className="font-mono">{server.name}</span>
          <Badge>{server.transport}</Badge>
          {server.builtin ? <Badge>{t('ext.mcp.builtin')}</Badge> : null}
          {!server.enabled ? <Badge>{t('ext.mcp.off')}</Badge> : null}
        </p>
        <p className="mt-0.5 truncate font-mono text-[11px] text-ink-3" title={server.launch}>{server.launch}</p>
        {keys.length > 0 ? (
          <p className="mt-0.5 text-[11px] text-ink-3">{t('ext.mcp.keys', { keys: keys.join(', ') })}</p>
        ) : null}
      </div>
      {onRemove ? (
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={busy}
          aria-label={t('ext.mcp.remove', { name: server.name })}
          onClick={onRemove}
        >
          <Trash2 />
        </Button>
      ) : null}
      {onToggle ? (
        <Switch
          checked={server.enabled}
          disabled={busy}
          onChange={onToggle}
          label={t('ext.mcp.toggle', { name: server.name })}
        />
      ) : null}
    </li>
  );
}

export function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-sm bg-surface-2 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-ink-3">
      {children}
    </span>
  );
}

/** `KEY=value` lines -> object. Returns the first bad line instead of guessing. */
export function parsePairs(text: string): { pairs: Record<string, string>; bad?: string } {
  const pairs: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const at = line.indexOf('=');
    if (at <= 0) return { pairs, bad: line };
    pairs[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return { pairs };
}

function AddServerDialog({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [transport, setTransport] = useState<'stdio' | 'http'>('stdio');
  const [command, setCommand] = useState('npx');
  const [args, setArgs] = useState('');
  const [url, setUrl] = useState('');
  const [httpTransport, setHttpTransport] = useState<'streamable-http' | 'sse'>('streamable-http');
  const [pairs, setPairs] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = parsePairs(pairs);
    if (parsed.bad) {
      toast.error(t('ext.failed'), t('ext.form.badPair', { line: parsed.bad }));
      return;
    }
    setBusy(true);
    try {
      await post('/api/extensions/mcp', {
        name: name.trim(),
        transport,
        command,
        args: args.split('\n').map((line) => line.trim()).filter(Boolean),
        url,
        http_transport: httpTransport,
        env: transport === 'stdio' ? parsed.pairs : {},
        headers: transport === 'http' ? parsed.pairs : {},
      });
      toast.ok(t('ext.form.added'), name.trim());
      onDone();
    } catch (error) {
      toast.error(t('ext.failed'), (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent title={t('ext.form.title')} description={glue(t('ext.form.description'))}>
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        <Labelled label={t('ext.form.name')} hint={t('ext.form.nameHint')} htmlFor="mcp-name">
          <Input
            id="mcp-name"
            required
            pattern="[A-Za-z0-9][A-Za-z0-9_\-]{0,47}"
            className="font-mono"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Labelled>
        <Labelled label={t('ext.form.transport')}>
          <Segmented
            ariaLabel={t('ext.form.transport')}
            value={transport}
            onChange={setTransport}
            items={[
              { value: 'stdio', label: t('ext.form.stdio') },
              { value: 'http', label: t('ext.form.http') },
            ]}
          />
        </Labelled>
        {transport === 'stdio' ? (
          <>
            <Labelled label={t('ext.form.command')} htmlFor="mcp-command">
              <Input
                id="mcp-command"
                required
                className="font-mono"
                value={command}
                onChange={(event) => setCommand(event.target.value)}
              />
            </Labelled>
            <Labelled label={t('ext.form.args')} hint={t('ext.form.argsHint')} htmlFor="mcp-args">
              <Textarea
                id="mcp-args"
                rows={3}
                className="font-mono text-[12px]"
                value={args}
                onChange={(event) => setArgs(event.target.value)}
              />
            </Labelled>
          </>
        ) : (
          <>
            <Labelled label={t('ext.form.url')} htmlFor="mcp-url">
              <Input
                id="mcp-url"
                type="url"
                required
                className="font-mono"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
              />
            </Labelled>
            <Labelled label={t('ext.form.httpTransport')} htmlFor="mcp-http">
              <Select
                id="mcp-http"
                value={httpTransport}
                onChange={(event) => setHttpTransport(event.target.value as typeof httpTransport)}
              >
                <option value="streamable-http">streamable-http</option>
                <option value="sse">sse</option>
              </Select>
            </Labelled>
          </>
        )}
        <Labelled
          label={transport === 'stdio' ? t('ext.form.env') : t('ext.form.headers')}
          hint={t('ext.form.pairsHint')}
          htmlFor="mcp-pairs"
        >
          <Textarea
            id="mcp-pairs"
            rows={3}
            autoComplete="off"
            spellCheck={false}
            className="font-mono text-[12px]"
            value={pairs}
            onChange={(event) => setPairs(event.target.value)}
          />
        </Labelled>
        <div className="flex justify-end">
          <Button type="submit" variant="solid" disabled={busy}>
            {busy ? t('ext.form.busy') : t('ext.form.submit')}
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}

export function Labelled({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="block text-[13px] text-ink">{label}</label>
      ) : (
        <span className="block text-[13px] text-ink">{label}</span>
      )}
      {children}
      {hint ? <p className="text-[11.5px] leading-snug text-ink-3">{glue(hint)}</p> : null}
    </div>
  );
}
