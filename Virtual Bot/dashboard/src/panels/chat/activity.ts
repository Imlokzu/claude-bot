import type { ToolEvent } from '../../lib/chatStream';
import type { ToolStep } from './types';

/** Older saved sessions used tool/name fields and did not record outcomes. */
export function restoreActivity(value: unknown): ToolStep[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && typeof item === 'object').map((item, index) => ({
    id: String(item.id || item.call_id || `saved-${index}`),
    label: String(item.label || item.tool || item.name || 'tool'),
    detail: String(item.detail || ''),
    status: ['done', 'failed', 'interrupted'].includes(item.status) ? item.status : 'interrupted',
    input: item.input ?? item.args,
    result: item.result,
    startedAt: item.startedAt,
    endedAt: item.endedAt,
    source: item.source,
  }));
}

/** One call, one row: progress and duplicate deliveries update in place. */
export function updateActivity(steps: ToolStep[], event: ToolEvent): ToolStep[] {
  if (event.step) {
    const next = [...steps];
    const index = next.findIndex((step) => step.id === event.step!.id);
    if (index === -1) next.push(event.step);
    else next[index] = event.step;
    return next;
  }
  const label = event.tool || 'tool';
  const index = event.call_id
    ? steps.findIndex((step) => step.id === event.call_id)
    : event.type === 'tool_start' ? -1 : steps.findIndex((step) => step.label === label && step.status === 'active');
  const old = steps[index];
  const terminal = ['tool_done', 'tool_result', 'tool_error'].includes(event.type);
  const result = event.result as { error?: unknown; isError?: boolean; ok?: boolean } | undefined;
  const failed = event.type === 'tool_error' || event.is_error || result?.error || result?.isError || result?.ok === false;
  const step: ToolStep = {
    ...(old || { id: event.call_id || `${label}-${steps.length}`, label, detail: '', status: 'active' }),
    detail: event.detail || old?.detail || '',
    ...(event.input !== undefined ? { input: event.input } : {}),
    ...(event.result !== undefined ? { result: event.result } : {}),
    ...(terminal ? { status: failed ? 'failed' : 'done' } : {}),
  };
  return index === -1 ? [...steps, step] : steps.map((item, i) => i === index ? step : item);
}

/** Missing completion is not proof of success. Keep this history on cancel. */
export function finishActivity(steps: ToolStep[]): ToolStep[] {
  return steps.map((step) => step.status === 'active' ? { ...step, status: 'interrupted' } : step);
}
