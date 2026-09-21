import { useEffect, useState } from 'react';
import { Check, Send, X } from 'lucide-react';
import { useBotEvents } from '@/hooks/useBotEvents';
import { t } from '@/lib/i18n';

interface UiPayload {
  id?: string;
  question?: string;
  title?: string;
  options?: (string | { label?: string; description?: string })[];
  allow_custom?: boolean;
  items?: { text?: string; done?: boolean }[];
}

type BotUi = { kind: string; data: UiPayload };

declare global {
  interface Window {
    __vbotSendMessage?: (text: string) => void;
  }
}

function send(text: string): void {
  const value = text.trim();
  if (value) window.__vbotSendMessage?.(value);
}

export function BotUiOverlay() {
  const [card, setCard] = useState<BotUi | null>(null);
  const [custom, setCustom] = useState('');

  useBotEvents((event) => {
    if (event.type !== 'ui') return;
    const data = event.data && typeof event.data === 'object' ? event.data as UiPayload : {};
    setCard({ kind: String(event.kind || ''), data });
    setCustom('');
  });

  useEffect(() => {
    if (!card) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCard(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [card]);

  if (!card) return null;
  const { data } = card;
  const options = (data.options ?? []).map((option) => typeof option === 'string'
    ? { label: option, description: '' }
    : { label: String(option.label || ''), description: String(option.description || '') });

  return (
    <aside className="bot-ui-overlay pointer-events-none fixed inset-x-3 z-[var(--z-modal)] flex justify-end sm:inset-x-auto sm:right-[260px] sm:w-[min(390px,calc(100vw-24px))]" aria-live="polite">
      <section className="pointer-events-auto w-full rounded-lg border border-accent/35 bg-surface p-3 shadow-pop u-pop">
        <header className="mb-2 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="u-label text-accent">{card.kind === 'question' ? 'Питання від бота' : data.title || 'Дія бота'}</p>
            {data.question ? <p className="mt-1 text-[14px] leading-relaxed text-ink">{data.question}</p> : null}
          </div>
          <button type="button" onClick={() => setCard(null)} aria-label={t('question.dismiss')} className="grid size-8 shrink-0 place-items-center rounded-sm text-ink-3 hover:bg-surface-2 hover:text-ink max-[759px]:size-11"><X size={15} /></button>
        </header>

        {card.kind === 'question' || card.kind === 'choice' ? (
          <div className="grid gap-1.5">
            {options.map((option) => (
              <button key={option.label} type="button" onClick={() => { send(option.label); setCard(null); }} className="flex min-h-11 items-center gap-2 rounded-md border border-line px-2.5 py-2 text-left text-[13px] text-ink-2 transition-colors hover:border-accent hover:bg-accent-soft hover:text-ink">
                <Check size={14} className="shrink-0 text-accent" />
                <span className="min-w-0 flex-1"><span className="block">{option.label}</span>{option.description ? <span className="mt-0.5 block text-[11px] text-ink-3">{option.description}</span> : null}</span>
              </button>
            ))}
            {card.kind === 'question' && data.allow_custom !== false ? (
              <form className="mt-1 flex gap-1.5" onSubmit={(event) => { event.preventDefault(); send(custom); if (custom.trim()) setCard(null); }}>
                <input value={custom} onChange={(event) => setCustom(event.target.value)} placeholder={t('question.custom')} className="min-w-0 flex-1 rounded-md border border-line bg-surface-2 px-2.5 py-2 text-[13px] outline-none focus:border-accent" />
                <button type="submit" aria-label={t('question.send')} className="grid min-h-11 min-w-11 place-items-center rounded-md bg-accent px-2.5 text-accent-ink"><Send size={14} /></button>
              </form>
            ) : null}
          </div>
        ) : card.kind === 'todo' ? (
          <ul className="space-y-1.5 text-[13px] text-ink-2">
            {(data.items ?? []).map((item, index) => <li key={`${item.text}-${index}`} className="flex items-center gap-2"><span className="grid size-4 place-items-center rounded border border-line"><Check size={11} className={item.done ? 'text-ok' : 'text-ink-3'} /></span>{item.text}</li>)}
          </ul>
        ) : null}
      </section>
    </aside>
  );
}
