import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import { cn } from '@/lib/cn';
import { t } from '@/locales/workspace';
import { shortNumber } from './tokens';

/*
 * What OpenClaw reports, not an estimate: the provider's own quota windows
 * (a ChatGPT subscription's 5-hour and weekly limits) and this chat's real
 * token counts priced by OpenClaw at API rates, cache included. The dollar
 * figure is what the same traffic would cost through the API; on a
 * subscription the actual spend is the flat plan.
 */

interface Costs {
  input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number;
  totalCost: number; inputCost: number; outputCost: number; cacheReadCost: number; cacheWriteCost: number;
  missingCostEntries: number;
}
interface Usage {
  model: string;
  quota: { provider: string; name: string; plan: string;
    windows: { label: string; used_percent: number | null; reset_at: number | null }[] }[] | null;
  session: (Costs & { model: string; provider: string; turns: number; tool_calls: number;
    avg_latency_ms: number | null }) | null;
  totals: (Costs & { days: number; indexing: boolean }) | null;
}

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
  const prompt = c.input + c.cacheRead + c.cacheWrite;
  const hit = prompt ? Math.round((c.cacheRead / prompt) * 100) : 0;
  const plain = withoutCache(c);
  return (
    <div className="space-y-1">
      <Row label={t('oc.input')} value={shortNumber(c.input)} />
      <Row label={t('oc.cached')} value={`${shortNumber(c.cacheRead)} · ${hit}%`} />
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

export function OpenClawUsagePin({ sessionId, turn }: { sessionId: string; turn: number }) {
  const usage = useQuery({
    queryKey: ['openclaw-usage', sessionId, turn],
    queryFn: () => get<Usage>(`/api/openclaw/usage${sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ''}`),
    placeholderData: (previous) => previous,
    refetchInterval: 60_000,
    staleTime: 15_000,
  });

  if (usage.isPending) return <p className="text-xs text-ink-3">{t('pins.loading')}</p>;
  if (usage.isError) return (
    <div className="text-xs text-ink-3" role="status">
      <p>{t('oc.unavailable')}</p>
      <button type="button" className="mt-2 text-accent" onClick={() => void usage.refetch()}>{t('pins.retry')}</button>
    </div>
  );

  const { model, quota, session, totals } = usage.data;
  return (
    <div className="space-y-3 text-[12.5px]">
      {quota?.map((provider) => (
        <div key={provider.provider} className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-ink-2">{provider.name}{provider.plan ? ` · ${provider.plan}` : ''}</span>
            <span className="u-data truncate text-[11px] text-ink-3">{(session?.model || model).split('/').pop()}</span>
          </div>
          {provider.windows.map((w) => {
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
      ))}

      <section>
        <h3 className="u-label mb-1.5">{t('oc.chat')}</h3>
        {session ? (
          <>
            <CostBlock c={session} />
            <p className="mt-1 text-[10.5px] text-ink-3">{t('oc.stats', {
              turns: session.turns,
              tools: session.tool_calls,
              sec: session.avg_latency_ms ? (session.avg_latency_ms / 1000).toFixed(1) : '—',
            })}</p>
          </>
        ) : <p className="text-xs text-ink-3">{t('oc.noSession')}</p>}
      </section>

      {totals ? (
        <section>
          <h3 className="u-label mb-1.5">{t('oc.days', { days: totals.days || 30 })}</h3>
          {totals.indexing ? <p className="text-xs text-ink-3">{t('oc.indexing')}</p> : <CostBlock c={totals} />}
        </section>
      ) : null}

      <p className="text-[10.5px] leading-snug text-ink-3">{t('oc.note')}</p>
    </div>
  );
}
