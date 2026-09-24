import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Orb } from '@/vendor/aicss';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toaster';
import { get, post } from '@/lib/api';
import { shortNumber, tokensFromChars } from './tokens';
import { cn } from '@/lib/cn';
import { t } from '@/locales/chat';

/*
 * Скільки контексту зайнято — і чим саме.
 *
 * Півколо в полі вводу заповнюється по мірі того, як розмова з'їдає вікно
 * моделі. Саме півколо, а не смужка: воно займає рівно стільки місця, скільки
 * може собі дозволити службовий знак поруч із текстом, і читається однією
 * миттю — важливо лише, «скільки лишилось».
 *
 * Розкладку рахує БЕКЕНД (/api/chat/context) тими самими функціями, що
 * збирають справжній запит. Клієнтська «приблизна копія» цієї збірки почала б
 * брехати на першій же правці промпту, а тут показана правда: скільки важить
 * характер, скільки — опис інструментів, скільки — історія.
 *
 * «Стиснути» — не косметика: бот бачить лише останні N реплік, і все, що
 * старіше, для нього не існує. Стискання просить мозок переказати розмову й
 * ставить переказ замість реплік, повертаючи суть у вікно. Оригінал
 * зберігається на диску (див. chat_store.compact).
 */

interface ContextPart {
  id: string;
  label: string;
  chars: number;
  messages?: number;
}
interface ContextBreakdown {
  parts: ContextPart[];
  chars: number;
  dropped: number;
  history_limit: number;
}

/** Півколо, що заповнюється. */
function Arc({ fill, size = 20, danger }: { fill: number; size?: number; danger: boolean }) {
  const r = 8;
  const len = Math.PI * r;
  return (
    <svg width={size} height={size * 0.62} viewBox="0 0 20 12" aria-hidden="true" className="shrink-0">
      <path
        d={`M1 11 A ${r} ${r} 0 0 1 19 11`}
        fill="none"
        stroke="var(--c-border)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d={`M1 11 A ${r} ${r} 0 0 1 19 11`}
        fill="none"
        stroke={danger ? 'var(--c-err)' : 'var(--c-accent)'}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeDasharray={`${(len * Math.min(100, fill)) / 100} ${len}`}
        style={{ transition: 'stroke-dasharray 320ms var(--e-out)' }}
      />
    </svg>
  );
}

/** A full ring for the sheet row, where there is room for a whole circle. */
function Ring({ fill, danger }: { fill: number; danger: boolean }) {
  const r = 9;
  const len = 2 * Math.PI * r;
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0 -rotate-90">
      <circle cx="12" cy="12" r={r} fill="none" stroke="var(--c-border)" strokeWidth="3" />
      <circle
        cx="12"
        cy="12"
        r={r}
        fill="none"
        stroke={danger ? 'var(--c-err)' : 'var(--c-accent)'}
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={`${(len * Math.min(100, Math.max(fill, 0))) / 100} ${len}`}
        style={{ transition: 'stroke-dasharray 320ms var(--e-out)' }}
      />
    </svg>
  );
}

export function ContextMeter({
  sessionId,
  contextSize,
  usedTokens,
  onCompacted,
  variant = 'inline',
}: {
  sessionId: string;
  /** Вікно моделі в токенах; 0 — у config.yaml не вказано. */
  contextSize: number;
  usedTokens: number;
  onCompacted: () => void;
  /** `inline` sits under the prompt bar; `row` is a full-width row in the phone sheet. */
  variant?: 'inline' | 'row';
}) {
  const [open, setOpen] = useState(false);
  const client = useQueryClient();
  const toast = useToast();

  const breakdown = useQuery({
    queryKey: ['chat-context', sessionId],
    queryFn: () =>
      get<ContextBreakdown>(
        `/api/chat/context${sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ''}`,
      ),
    // Тягнемо лише коли панель відкрита: поки її не відкрили, число над полем
    // вводу дає оцінку з того, що вже є на клієнті, і зайвий запит на кожну
    // репліку нічого б не додав.
    enabled: open,
    staleTime: 5_000,
  });

  const compact = useMutation({
    mutationFn: () => post<{ summary: string; before: number }>(`/api/sessions/${encodeURIComponent(sessionId)}/compact`),
    onSuccess: (result) => {
      toast.toast(t('context.compacted', { count: result.before }));
      void client.invalidateQueries({ queryKey: ['chat-context'] });
      void client.invalidateQueries({ queryKey: ['sessions'] });
      setOpen(false);
      onCompacted();
    },
    onError: (error) => toast.error(t('context.compactFailed'), (error as Error).message),
  });

  const fill = contextSize > 0 ? (usedTokens / contextSize) * 100 : 0;
  const danger = fill > 85;
  const total = breakdown.data?.chars ?? 0;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        {variant === 'row' ? (
          <button
            type="button"
            className="flex min-h-14 w-full items-center gap-3 rounded-lg bg-surface-2 px-4 text-left transition-colors hover:bg-surface-3"
            aria-label={t('context.aria')}
          >
            <Ring fill={fill} danger={danger} />
            <span className="font-mono text-[15px] text-ink">{t('context.row')}</span>
            <span className={cn('u-data ml-auto text-[14px]', danger ? 'text-err' : 'text-ink-2')}>
              {shortNumber(usedTokens)}
              {contextSize > 0 ? `/${shortNumber(contextSize)}` : t('context.tokens')}
            </span>
          </button>
        ) : (
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 transition-colors hover:bg-surface-2"
            aria-label={t('context.aria')}
          >
            {contextSize > 0 ? <Arc fill={fill} danger={danger} /> : null}
            <span className={cn('u-data text-[10.5px]', danger ? 'text-err' : 'text-ink-3')}>
              ≈{shortNumber(usedTokens)}
              {contextSize > 0 ? ` / ${shortNumber(contextSize)}` : t('context.tokens')}
            </span>
          </button>
        )}
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side="top"
          sideOffset={8}
          collisionPadding={12}
          style={{ zIndex: 'var(--z-pop)' }}
          className="popup-shell u-pop w-[min(340px,calc(100vw-24px))] rounded-lg border border-line bg-surface p-3 shadow-pop"
        >
          <div className="popup-plate liquid-glass" aria-hidden="true" />
          <p className="u-label mb-2.5">{t('context.title')}</p>

          {breakdown.isPending ? (
            <div className="flex items-center gap-2 py-3">
              <Orb variant="C4" size={14} />
              <span className="text-[13px] text-ink-3">{t('context.counting')}</span>
            </div>
          ) : breakdown.isError ? (
            <p className="py-2 text-[13px] text-err">{(breakdown.error as Error).message}</p>
          ) : (
            <ul className="u-stagger space-y-1.5">
              {breakdown.data!.parts.map((part) => {
                const share = total > 0 ? (part.chars / total) * 100 : 0;
                return (
                  <li key={part.id} className="flex items-center gap-2.5 text-[12.5px]">
                    <span className="min-w-0 flex-1 truncate text-ink-2">
                      {part.label}
                      {part.messages !== undefined ? (
                        <span className="text-ink-3"> · {part.messages} {t('context.replies')}</span>
                      ) : null}
                    </span>
                    {/* Смужка частки: із самих лише чисел не видно, що опис
                        інструментів важить більше за всю розмову. */}
                    <span className="h-1 w-14 shrink-0 overflow-hidden rounded-full bg-surface-3">
                      <span
                        className="block h-full rounded-full bg-accent"
                        style={{ width: `${Math.max(2, share)}%` }}
                      />
                    </span>
                    <span className="u-data w-11 shrink-0 text-right text-[11px] text-ink-3">
                      ≈{shortNumber(tokensFromChars(part.chars))}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          {breakdown.data && breakdown.data.dropped > 0 ? (
            <p className="mt-2.5 text-[12px] leading-snug text-ink-3">
              {t('context.dropped', { count: breakdown.data.dropped, limit: breakdown.data.history_limit })}
            </p>
          ) : null}

          <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-2.5">
            <span className="text-[11.5px] text-ink-3">
              {contextSize > 0
                // «0%» на мільйонному вікні — неправда: щось же зайнято.
                // Тому все, що менше відсотка, називаємо «менше 1%».
                ? fill < 1
                  ? t('context.belowOne')
                  : t('context.share', { percent: Math.round(fill) })
                : t('context.unknown')}
            </span>
            <Button
              size="sm"
              variant="quiet"
              disabled={!sessionId || compact.isPending}
              onClick={() => compact.mutate()}
            >
              {compact.isPending ? t('context.compacting') : t('context.compact')}
            </Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
