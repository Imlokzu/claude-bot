import { useEffect, useMemo, useRef, useState } from 'react';

import { Panel, PanelHead } from '@/components/ui/Panel';
import { SwitchRow } from '@/components/ui/Switch';
import { Empty } from '@/components/ui/Feedback';
import { Input } from '@/components/ui/Field';
import { useBotEvents } from '@/hooks/useBotEvents';
import { get } from '@/lib/api';
import { cn } from '@/lib/cn';
import { SectionHeader } from '@/components/shell/SectionHeader';
import { BellToggle, HoldButton } from '@/vendor/reactbits';
import { useCssVar } from '@/hooks/useAccentRgb';

/*
 * Консоль бота.
 *
 * Історія приїжджає раз (/api/console), далі рядки додає стрічка подій.
 * Буфер обмежений: панель відкрита годинами, і необмежений масив у памʼяті
 * вкладки з часом стає помітним.
 */

const MAX_LINES = 1500;

interface LogLine {
  key: number;
  t?: number;
  level: string;
  name: string;
  msg: string;
}

const LEVEL_TONE: Record<string, string> = {
  ERROR: 'text-err',
  CRITICAL: 'text-err',
  WARNING: 'text-warn',
  INFO: 'text-ink-2',
  DEBUG: 'text-ink-3',
};

function time(ts?: number): string {
  if (!ts) return '--:--:--';
  const date = new Date(ts * 1000);
  return date.toLocaleTimeString('uk', { hour12: false });
}

/** Логер python пише повне імʼя модуля; у колонці корисний лише хвіст. */
function shortName(name: string): string {
  const parts = name.split('.');
  return parts[parts.length - 1] || name;
}

export default function LogsPanel() {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [autoscroll, setAutoscroll] = useState(true);
  const [filter, setFilter] = useState('');
  const keyRef = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [notify, setNotify] = useState(false);
  const errorCount = lines.filter((line) => line.level === 'ERROR' || line.level === 'CRITICAL').length;

  const accent = useCssVar('--c-accent', '#b95f3d');
  const accentInk = useCssVar('--c-accent-ink', '#fff');
  const surface2 = useCssVar('--c-surface-2', '#efe9df');
  const ink = useCssVar('--c-text', '#231e19');

  useEffect(() => {
    let cancelled = false;
    void get<{ logs: Omit<LogLine, 'key'>[] }>('/api/console')
      .then((data) => {
        if (cancelled) return;
        setLines(
          (data.logs ?? []).slice(-MAX_LINES).map((line) => ({ ...line, key: keyRef.current++ })),
        );
      })
      .catch(() => {
        // Історія — приємність, а не умова роботи: стрічка подій усе одно
        // наповнить консоль живими рядками.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useBotEvents((event) => {
    if (event.type !== 'log') return;
    const level = String(event.level ?? 'INFO');
    if (notify && (level === 'ERROR' || level === 'CRITICAL')) {
      try {
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('Клод Бот: збій', { body: String(event.msg ?? '').slice(0, 180) });
        }
      } catch {
        // Сповіщення — приємність; його відмова не має зачіпати консоль.
      }
    }
    setLines((current) => {
      const next = [
        ...current,
        {
          key: keyRef.current++,
          t: Number(event.t) || undefined,
          level,
          name: String(event.name ?? ''),
          msg: String(event.msg ?? ''),
        },
      ];
      return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
    });
  });

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return lines;
    return lines.filter(
      (line) =>
        line.msg.toLowerCase().includes(needle) || line.name.toLowerCase().includes(needle),
    );
  }, [lines, filter]);

  useEffect(() => {
    if (autoscroll) bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [shown, autoscroll]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 sm:p-6">
      <SectionHeader label="ЛОГИ" title="Консоль бота" />
      <Panel flush className="min-h-0 flex-1">
        <div className="shrink-0 border-b border-line p-3">
          <PanelHead
            className="mb-2"
            label="консоль"
            hint={`${shown.length} рядк.`}
            actions={
              <>
                {/* Сповіщення про помилки: панель відкрита годинами, і рядок
                    ERROR у стрічці, на яку ніхто не дивиться, — це збій, про
                    який дізнаються надто пізно. */}
                <BellToggle
                  offLabel="Сповіщати про збої"
                  onLabel="Сповіщаю"
                  size="sm"
                  radius={999}
                  pressed={notify}
                  onChange={async (next) => {
                    if (next && 'Notification' in window && Notification.permission === 'default') {
                      await Notification.requestPermission();
                    }
                    setNotify(next);
                  }}
                  count={errorCount}
                  badge
                  color={ink}
                  background={surface2}
                  onColor={accentInk}
                  onBackground={accent}
                />
                {/* Очищення — з утриманням: консоль часто єдиний слід того,
                    що щойно сталось, і знести її одним випадковим кліком не
                    має бути можливо. */}
                <HoldButton
                  onHold={() => setLines([])}
                  doneLabel="Очищено"
                  holdTime={700}
                  size="sm"
                  radius={8}
                  backgroundColor={surface2}
                  textColor={ink}
                  fillColor={accent}
                  fillTextColor={accentInk}
                >
                  Тримай, щоб очистити
                </HoldButton>
              </>
            }
          />
          <div className="flex items-center gap-3">
            <Input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Фільтр за текстом або модулем…"
              className="h-8 flex-1 text-[13px]"
            />
            <div className="shrink-0">
              <SwitchRow label="Автоскрол" checked={autoscroll} onChange={setAutoscroll} />
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-3">
          {shown.length === 0 ? (
            <Empty title="Порожньо" hint="Тут зʼявляться рядки, щойно бот щось зробить." />
          ) : (
            <table className="w-full border-separate border-spacing-0 font-mono text-[12px] leading-[1.7]">
              <tbody>
                {shown.map((line) => (
                  <tr key={line.key} className="align-baseline">
                    <td className="w-[74px] whitespace-nowrap pr-3 text-ink-3 tabular-nums">
                      {time(line.t)}
                    </td>
                    <td className="w-[110px] truncate pr-3 text-ink-3">{shortName(line.name)}</td>
                    <td className={cn('whitespace-pre-wrap break-words', LEVEL_TONE[line.level] ?? 'text-ink-2')}>
                      {line.msg}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div ref={bottomRef} />
        </div>
      </Panel>
    </div>
  );
}
