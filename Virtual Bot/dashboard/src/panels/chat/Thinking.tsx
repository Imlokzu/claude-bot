import { useMemo } from 'react';
import { Check, ChevronRight, CircleSlash, X } from 'lucide-react';
import { Orb, ThinkingReasoning } from '@/vendor/aicss';
import { LatticeLoader } from '@/vendor/reactbits';
import { toolLook } from '@/lib/toolLabels';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import type { AgentStatus } from '@/lib/chatStream';
import type { ToolStep } from './types';

function Payload({ value }: { value: unknown }) {
  return <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface px-3 py-2 font-mono text-[11px] leading-relaxed text-ink-2">{
    typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  }</pre>;
}

function ToolActivity({ step }: { step: ToolStep }) {
  const duration = step.startedAt && step.endedAt
    ? Math.max(0, (step.endedAt - step.startedAt) / 1000).toFixed(1) : null;
  return (
    <details className="group min-w-0 border-l border-line pl-3" data-tool-status={step.status}>
      <summary className="flex cursor-pointer list-none items-start gap-2 rounded-sm py-1.5 text-[12px] text-ink-2 outline-none transition-colors hover:bg-surface focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-details-marker]:hidden">
        <span className={cn('mt-0.5 shrink-0', step.status === 'failed' ? 'text-err' : step.status === 'done' ? 'text-ok' : 'text-ink-3')}>
          {step.status === 'active' ? <Orb variant={toolLook(step.label).orb} size={14} />
            : step.status === 'done' ? <Check className="size-3.5" />
              : step.status === 'failed' ? <X className="size-3.5" /> : <CircleSlash className="size-3.5" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="break-all font-mono font-medium text-ink">{step.label}</span>
            <span className={cn('font-sans text-[11px]', step.status === 'failed' && 'text-err')}>{t(`activity.${step.status}`)}</span>
            {duration !== null && <span className="font-mono text-[10px] text-ink-3">{t('activity.seconds', { seconds: duration })}</span>}
          </span>
          {step.detail && <span className="mt-0.5 block break-words font-sans text-ink-3">{step.detail}</span>}
        </span>
        <ChevronRight className="mt-0.5 size-3.5 shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none" />
      </summary>
      <div className="space-y-2 pb-3 pl-5">
        {step.input !== undefined && <section><p className="mb-1 font-sans text-[11px] text-ink-3">{t('activity.input')}</p><Payload value={step.input} /></section>}
        {step.result !== undefined
          ? <section><p className="mb-1 font-sans text-[11px] text-ink-3">{t(step.status === 'active' ? 'activity.partial' : 'activity.result')}</p><Payload value={step.result} /></section>
          : <p className="font-sans text-[11px] text-ink-3">{t('activity.noResult')}</p>}
      </div>
    </details>
  );
}

/** Real, request-scoped actions. No generated or simulated reasoning. */
export function Thinking({ steps, running, status, model }: {
  steps: ToolStep[]; running: boolean; status?: AgentStatus; model?: string;
}) {
  const lines = useMemo(() => steps.map((step) => <ToolActivity key={step.id} step={step} />), [steps]);
  return (
    <div className="mb-4 min-w-0" data-agent-activity>
      {model || running ? (
        <p className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
          <span className="size-1.5 rounded-full bg-accent" aria-hidden="true" />
          OpenClaw · {model || 'підключення'}
        </p>
      ) : null}
      <ThinkingReasoning
        lines={lines}
        busy={running}
        detailed
        label={t('activity.running')}
        doneLabel={() => t('activity.summary', { count: steps.length })}
        glyph={<span aria-hidden="true"><LatticeLoader status={running ? 'working' : 'done'} showTimer={false}
          label="" doneLabel="" errorLabel="" cellSize={4} gap={2} color="var(--c-accent)"
          doneColor="var(--c-ok)" idleOpacity={0.18} /></span>}
      />
      {running && (status === 'unavailable' || status === 'disconnected' || !steps.length) && (
        <p role="status" className={cn('mt-2 text-[12px] leading-relaxed',
          status === 'unavailable' || status === 'disconnected' ? 'text-warn' : 'text-ink-3')}>
          {t(status === 'unavailable' ? 'activity.unavailable' : status === 'disconnected' ? 'activity.disconnected'
            : status === 'connecting' ? 'activity.connecting' : 'activity.waiting')}
        </p>
      )}
    </div>
  );
}
