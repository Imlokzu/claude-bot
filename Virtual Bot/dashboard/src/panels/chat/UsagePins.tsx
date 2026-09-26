import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import { cn } from '@/lib/cn';
import { t } from '@/locales/workspace';
import { estimateTokens, shortNumber } from './tokens';
import type { ChatMessage } from './types';

/*
 * Two panels over what OpenClaw reports, not estimates.
 *
 * ChatUsagePin: this chat's real token counts with the cache split, priced by
 * OpenClaw at the provider's API rates (checked against the raw transcript and
 * OpenAI's published price list). When OpenClaw never answered this chat it
 * falls back to the old estimate from the visible text, labelled as such.
 *
 * AccountsPin: every provider account OpenClaw holds, with quota windows where
 * the provider reports them (ChatGPT subscription: 5 hours and week) and the
 * last 30 days of traffic. On a subscription the real spend is the flat plan;
 * the dollar figure is what the API would have charged.
 */

interface Costs {
  input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number;
  totalCost: number; inputCost: number; outputCost: number; cacheReadCost: number; cacheWriteCost: number;
  missingCostEntries: number;
}
interface ChatUsage {
  model: string;
  session: (Costs & { model: string; provider: string; turns: number; tool_calls: number;
    avg_latency_ms: number | null }) | null;
}
interface Quota {
  provider: string; name: string; plan: string;
  windows: { label: string; used_percent: number | null; reset_at: number | null }[];
}
interface Account extends Costs { provider: string; auth: string; replies: number; quota: Quota | null }
interface Accounts { days: number; accounts: Account[]; totals: Costs | null; indexing: boolean; available: boolean }

const PROVIDER_NAMES: Record<string, string> = {
  openai: 'OpenAI', anthropic: 'Anthropic', nvidia: 'NVIDIA', regolo: 'Regolo',
  'opencode-go': 'opencode Go', omni: 'Omni', elevenlabs: 'ElevenLabs', google: 'Google',
};

function money(value: number): string {
  if (!value) return '$0';
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(4)}`;
}

function resetIn(at: number | null): string {
  if (!at) return '';
  const minutes = Math.max(0, Math.round((at - Date.now()) / 60_000));
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  const time = d ? t('oc.dur.dh', { d, h }) : h ? t('oc.dur.hm', { h, m }) : t('oc.dur.m', { m });
  return t('oc.resetIn', { time });
}

function windowLabel(label: string): string {
  if (label === '5h') return t('oc.win.5h');
  if (label.toLowerCase() === 'week') return t('oc.win.week');
  return label;
}

function cacheShare(c: Costs): number {
  const prompt = c.input + c.cacheRead + c.cacheWrite;
  return prompt ? Math.round((c.cacheRead / prompt) * 100) : 0;
}

/** Same traffic with every cached token billed as fresh input. */
function withoutCache(c: Costs): number | null {
  if (!c.cacheRead || !c.input || !c.inputCost) return null;
  return c.totalCost - c.cacheReadCost + c.cacheRead * (c.inputCost / c.input);
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-ink-3">{label}</span>
      <span className={cn('u-data', strong ? 'text-ink' : 'text-ink-2')}>{value}</span>
    </div>
  );
}

function CostBlock({ c }: { c: Costs }) {
  const plain = withoutCache(c);
  return (
    <div className="space-y-1">
      <Row label={t('oc.input')} value={shortNumber(c.input)} />
      <Row label={t('oc.cached')} value={`${shortNumber(c.cacheRead)} · ${cacheShare(c)}%`} />
      {c.cacheWrite ? <Row label={t('oc.cacheWrite')} value={shortNumber(c.cacheWrite)} /> : null}
      <Row label={t('oc.output')} value={shortNumber(c.output)} />
      <div className="border-t border-line pt-1">
        <Row label={t('oc.apiCost')} value={money(c.totalCost)} strong />
        {plain !== null ? <Row label={t('oc.noCache')} value={money(plain)} /> : null}
      </div>
      {c.missingCostEntries ? (
        <p className="text-[10.5px] text-ink-3">{t('oc.missing', { count: c.missingCostEntries })}</p>
      ) : null}
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="text-xs text-ink-3" role="status">
      <p>{t('oc.unavailable')}</p>
      <button type="button" className="mt-2 text-accent" onClick={onRetry}>{t('pins.retry')}</button>
    </div>
  );
}

function EstimateBlock({ messages }: { messages: ChatMessage[] }) {
  const input = estimateTokens(messages.filter((m) => m.role === 'user'));
  const output = estimateTokens(messages.filter((m) => m.role === 'assistant'));
  return (
    <div className="space-y-1">
      <Row label={t('pins.usageIn')} value={`≈${shortNumber(input)}`} />
      <Row label={t('pins.usageOut')} value={`≈${shortNumber(output)}`} />
      <p className="text-[10.5px] leading-snug text-ink-3">{t('oc.estimate')}</p>
    </div>
  );
}

export function ChatUsagePin({ sessionId, messages }: { sessionId: string; messages: ChatMessage[] }) {
  const turn = messages.filter((m) => m.role === 'assistant').length;
  const usage = useQuery({
    queryKey: ['openclaw-chat-usage', sessionId, turn],
    queryFn: () => get<ChatUsage>(`/api/openclaw/usage${sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ''}`),
    placeholderData: (previous) => previous,
    staleTime: 15_000,
  });

  if (usage.isPending) return <p className="text-xs text-ink-3">{t('pins.loading')}</p>;
  if (usage.isError) return <ErrorState onRetry={() => void usage.refetch()} />;
  const { session, model } = usage.data;
  if (!session) return <EstimateBlock messages={messages} />;

  return (
    <div className="space-y-1.5 text-[12.5px]">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-ink-2">{PROVIDER_NAMES[session.provider] ?? session.provider}</span>
        <span className="u-data truncate text-[11px] text-ink-3">{(session.model || model).split('/').pop()}</span>
      </div>
      <CostBlock c={session} />
      <p className="text-[10.5px] text-ink-3">{t('oc.stats', {
        turns: session.turns,
        tools: session.tool_calls,
        sec: session.avg_latency_ms ? (session.avg_latency_ms / 1000).toFixed(1) : '—',
      })}</p>
    </div>
  );
}

function QuotaBars({ quota }: { quota: Quota }) {
  return (
    <div className="space-y-1.5">
      {quota.windows.map((w) => {
        const used = Math.max(0, Math.min(100, w.used_percent ?? 0));
        return (
          <div key={w.label}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-ink-3">{windowLabel(w.label)}</span>
              <span className="u-data text-ink-2">{used}%</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3" role="meter"
                 aria-valuemin={0} aria-valuemax={100} aria-valuenow={used} aria-label={windowLabel(w.label)}>
              <div className={cn('h-full rounded-full', used >= 90 ? 'bg-err' : used >= 70 ? 'bg-warn' : 'bg-ok')}
                   style={{ width: `${used}%` }} />
            </div>
            <p className="mt-0.5 text-[10.5px] text-ink-3">{resetIn(w.reset_at)}</p>
          </div>
        );
      })}
    </div>
  );
}

function AccountRow({ account }: { account: Account }) {
  const name = PROVIDER_NAMES[account.provider] ?? account.provider;
  const auth = account.auth === 'oauth' ? t('oc.auth.oauth') : account.auth === 'api_key' ? t('oc.auth.key') : '';
  let traffic: string;
  if (!account.replies) traffic = t('oc.acc.idle');
  else if (!account.totalTokens) traffic = t('oc.acc.noTokens', { replies: account.replies });
  else traffic = t('oc.acc.traffic', { replies: account.replies, tokens: shortNumber(account.totalTokens) })
    + (account.cacheRead ? ` · ${t('oc.acc.cache', { share: cacheShare(account) })}` : '');
  return (
    <div className="space-y-1.5 border-t border-line pt-2 first:border-t-0 first:pt-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-ink-2">
          {name}{account.quota?.plan ? ` · ${account.quota.plan}` : ''}
          {auth ? <span className="ml-1.5 text-[10.5px] text-ink-3">{auth}</span> : null}
        </span>
        {account.totalCost ? <span className="u-data text-ink">{money(account.totalCost)}</span> : null}
      </div>
      {account.quota ? <QuotaBars quota={account.quota} /> : null}
      <p className="text-[10.5px] text-ink-3">
        {traffic}
        {account.missingCostEntries ? ` · ${t('oc.missing', { count: account.missingCostEntries })}` : ''}
      </p>
    </div>
  );
}

export function AccountsPin() {
  const accounts = useQuery({
    queryKey: ['openclaw-accounts'],
    queryFn: () => get<Accounts>('/api/openclaw/accounts'),
    placeholderData: (previous) => previous,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  if (accounts.isPending) return <p className="text-xs text-ink-3">{t('pins.loading')}</p>;
  if (accounts.isError) return <ErrorState onRetry={() => void accounts.refetch()} />;
  const { days, totals, indexing, available } = accounts.data;
  const list = accounts.data.accounts;

  return (
    <div className="space-y-3 text-[12.5px]">
      {list.length ? (
        <div className="space-y-2">{list.map((account) => <AccountRow key={account.provider} account={account} />)}</div>
      ) : <p className="text-xs text-ink-3">{available ? t('oc.acc.none') : t('oc.unavailable')}</p>}

      {totals ? (
        <section>
          <h3 className="u-label mb-1.5">{t('oc.days', { days: days || 30 })}</h3>
          {indexing ? <p className="text-xs text-ink-3">{t('oc.indexing')}</p> : <CostBlock c={totals} />}
        </section>
      ) : null}

      <p className="text-[10.5px] leading-snug text-ink-3">{t('oc.note')}</p>
    </div>
  );
}
