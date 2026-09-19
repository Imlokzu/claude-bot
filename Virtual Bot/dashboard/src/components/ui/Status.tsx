import { LatticeLoader, StatusMark } from '@/vendor/reactbits';
import { cn } from '@/lib/cn';

/*
 * Стани. Шкала окремо від акценту: «працює / увага / впало / спить» не мають
 * залежати від того, який колір людина обрала для оздоблення (DESIGN.md).
 */

export type StatusKind = 'ok' | 'warn' | 'err' | 'idle' | 'busy';

const TONE: Record<StatusKind, string> = {
  ok: 'var(--c-ok)',
  warn: 'var(--c-warn)',
  err: 'var(--c-err)',
  idle: 'var(--c-idle)',
  busy: 'var(--c-accent)',
};

/** Крапка стану — рівно те, що було `.dot` у старій панелі. */
export function Dot({ kind, className }: { kind: StatusKind; className?: string }) {
  return (
    <span
      className={cn('inline-block size-2 shrink-0 rounded-full', className)}
      style={{
        background: TONE[kind],
        // Спокійне світіння лише в живих станах: у «спить» воно б брехало.
        boxShadow: kind === 'ok' || kind === 'busy' ? `0 0 0 3px color-mix(in oklab, ${TONE[kind]} 22%, transparent)` : undefined,
      }}
    />
  );
}

/** Значок кроку з анімацією домальовування — для ходу тулзів. */
export function StepMark({
  status,
  label,
  progress,
}: {
  status: 'pending' | 'active' | 'done' | 'failed';
  label?: string;
  progress?: number;
}) {
  return (
    <StatusMark
      status={status}
      label={label}
      progress={progress}
      size={16}
      strokeWidth={1.8}
      fontSize={12}
      color="var(--c-text-3)"
      doneColor="var(--c-ok)"
      errorColor="var(--c-err)"
    />
  );
}

/** Завантаження з таймером — чесніше за нескінченний спінер. */
export function Loader({
  label = 'Працюю',
  doneLabel = 'Готово за',
  status = 'working',
  showTimer = true,
}: {
  label?: string;
  doneLabel?: string;
  status?: 'working' | 'done' | 'error';
  showTimer?: boolean;
}) {
  return (
    <LatticeLoader
      label={label}
      doneLabel={doneLabel}
      errorLabel="Впало за"
      status={status}
      showTimer={showTimer}
      cellSize={5}
      gap={2}
      fontSize={12}
      color="var(--c-accent)"
      doneColor="var(--c-ok)"
      errorColor="var(--c-err)"
      idleOpacity={0.18}
    />
  );
}
