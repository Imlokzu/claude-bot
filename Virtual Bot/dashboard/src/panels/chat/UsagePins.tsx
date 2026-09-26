import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import { get } from '@/lib/api';
import { cn } from '@/lib/cn';
import { t } from '@/locales/workspace';
import { estimateTokens, shortNumber } from './tokens';
import { MAIN_ACCOUNT_KEY, splitAccounts } from './accounts';
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
  /** Computed per model on the server: cached tokens billed at that model's own input price. */
  noCacheCost?: number | null;
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

/** Same traffic with every cached token billed as fresh input; hidden when the cache saved nothing. */
function withoutCache(c: Costs): number | null {
  const value = c.noCacheCost;
  return value != null && value - c.totalCost > 0.00005 ? value : null;
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

function accountName(account: Account): string {
  const name = PROVIDER_NAMES[account.provider] ?? account.provider;
  return account.quota?.plan ? `${name} · ${account.quota.plan}` : name;
}

function authLabel(account: Account): string {
  return account.auth === 'oauth' ? t('oc.auth.oauth') : account.auth === 'api_key' ? t('oc.auth.key') : '';
}

function trafficLine(account: Account): string {
  const parts: string[] = [];
  if (!account.replies) parts.push(t('oc.acc.idle'));
  else if (!account.totalTokens) parts.push(t('oc.acc.noTokens', { replies: account.replies }));
  else {
    parts.push(t('oc.acc.traffic', { replies: account.replies, tokens: shortNumber(account.totalTokens) }));
    if (account.cacheRead) parts.push(t('oc.acc.cache', { share: cacheShare(account) }));
  }
  if (account.missingCostEntries) parts.push(t('oc.acc.unpriced', { count: account.missingCostEntries }));
  return parts.join(' · ');
}

function AccountMenu({ accounts, main, onChoose }: {
  accounts: Account[]; main: Account; onChoose: (provider: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const auth = authLabel(main);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" aria-label={`${accountName(main)} — ${t('oc.acc.choose')}`}
          className="-mx-1 flex w-[calc(100%+0.5rem)] min-w-0 items-center gap-1 rounded-sm px-1 py-0.5 text-left outline-none transition-colors hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-accent">
          <span className="min-w-0 truncate text-ink-2">{accountName(main)}</span>
          <ChevronDown size={13} className="shrink-0 text-ink-3" />
          {auth ? <span className="ml-auto shrink-0 text-[10.5px] text-ink-3">{auth}</span> : null}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="bottom" align="start" sideOffset={6} collisionPadding={12}
          className="popup-shell u-pop z-50 w-60 rounded-md border border-line bg-surface p-1.5 shadow-pop">
          <div className="popup-plate liquid-glass" aria-hidden="true" />
          <p className="u-label px-2 pb-1 pt-1">{t('oc.acc.main')}</p>
          {accounts.map((account) => {
            const current = account === main;
            const hint = [authLabel(account), account.replies ? t('oc.acc.replies', { replies: account.replies }) : t('oc.acc.idle')]
              .filter(Boolean).join(' · ');
            return (
              <button key={account.provider} type="button" aria-pressed={current}
                onClick={() => { onChoose(account.provider); setOpen(false); }}
                className="flex min-h-11 w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-surface-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-ink-2">{accountName(account)}</span>
                  <span className="block truncate text-[11px] text-ink-3">{hint}</span>
                </span>
                {current ? <Check size={14} className="shrink-0 text-accent" /> : null}
              </button>
            );
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** The main account in full: its limits, what its traffic would cost at API prices, and the traffic. */
function MainAccount({ account, days, indexing }: { account: Account; days: number; indexing: boolean }) {
  const plain = withoutCache(account);
  return (
    <div className="space-y-2">
      {account.quota ? <QuotaBars quota={account.quota} /> : null}
      {indexing ? <p className="text-xs text-ink-3">{t('oc.indexing')}</p> : (
        <>
          {account.totalCost ? (
            <div className="space-y-1" title={t('oc.note')}>
              <Row label={t('oc.acc.cost', { days })} value={money(account.totalCost)} strong />
              {plain !== null ? <Row label={t('oc.noCache')} value={money(plain)} /> : null}
            </div>
          ) : null}
          <p className="text-[10.5px] text-ink-3">{trafficLine(account)}</p>
        </>
      )}
    </div>
  );
}

/** Any other account, two lines: name and cost, then limits and traffic. */
function OtherAccount({ account }: { account: Account }) {
  const limits = account.quota?.windows.map((w) => `${windowLabel(w.label)} ${Math.round(w.used_percent ?? 0)}%`) ?? [];
  return (
    <div className="border-t border-line pt-2 first:border-t-0 first:pt-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-ink-2">{accountName(account)}</span>
        {account.totalCost ? <span className="u-data text-ink-2">{money(account.totalCost)}</span> : null}
      </div>
      <p className="text-[10.5px] text-ink-3">{[...limits, trafficLine(account)].join(' · ')}</p>
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
  const [preferred, setPreferred] = useState<string | null>(() => {
    try { return localStorage.getItem(MAIN_ACCOUNT_KEY); } catch { return null; }
  });
  const [othersOpen, setOthersOpen] = useState(false);
  const choose = (provider: string) => {
    setPreferred(provider);
    try { localStorage.setItem(MAIN_ACCOUNT_KEY, provider); } catch { /* Session-only fallback. */ }
  };

  if (accounts.isPending) return <p className="text-xs text-ink-3">{t('pins.loading')}</p>;
  if (accounts.isError) return <ErrorState onRetry={() => void accounts.refetch()} />;
  const { totals, indexing, available } = accounts.data;
  const days = accounts.data.days || 30;
  const { main, others } = splitAccounts(accounts.data.accounts, preferred);
  if (!main) return <p className="text-xs text-ink-3">{available ? t('oc.acc.none') : t('oc.unavailable')}</p>;

  return (
    <div className="space-y-2.5 text-[12.5px]">
      <AccountMenu accounts={accounts.data.accounts} main={main} onChoose={choose} />
      <MainAccount account={main} days={days} indexing={indexing} />
      {others.length ? (
        <div className="border-t border-line pt-2">
          <button type="button" aria-expanded={othersOpen} onClick={() => setOthersOpen((open) => !open)}
            className="flex items-center gap-1 text-[11px] text-ink-3 outline-none hover:text-ink-2 focus-visible:ring-2 focus-visible:ring-accent">
            <ChevronRight className={cn('size-3 transition-transform duration-200 motion-reduce:transition-none', othersOpen && 'rotate-90')} />
            {t('oc.acc.others', { count: others.length })}
          </button>
          {/* The same fold as the tool logs under a chat card (base.css, .chat-log). */}
          <div className="chat-log" data-open={othersOpen ? '' : undefined} inert={!othersOpen}>
            <div className="chat-log-clip">
              <div className="chat-log-panel space-y-2 pt-2">
                {others.map((account) => <OtherAccount key={account.provider} account={account} />)}
                {totals ? (
                  <section className="border-t border-line pt-2">
                    <h3 className="u-label mb-1.5">{t('oc.acc.all', { days })}</h3>
                    {indexing ? <p className="text-xs text-ink-3">{t('oc.indexing')}</p> : <CostBlock c={totals} />}
                  </section>
                ) : null}
                <p className="text-[10.5px] leading-snug text-ink-3">{t('oc.note')}</p>
              </div>
            </div>
          </div>
        </div>
      ) : <p className="text-[10.5px] leading-snug text-ink-3">{t('oc.note')}</p>}
    </div>
  );
}
