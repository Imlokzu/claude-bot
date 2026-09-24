import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookMarked, Languages, Scissors, Sparkles } from 'lucide-react';
import { t, type ChatKey } from '@/locales/chat';

/*
 * Ask about a piece of a reply without retyping it.
 *
 * Long answers get one paragraph that needs unpacking, shortening or
 * translating, and the only way to ask about it was to select it, copy it,
 * paste it into the composer and write a request around it. Selecting the
 * text already says which part is meant; this turns that selection into the
 * question directly.
 *
 * Bot replies only. A selection inside your own message is usually the start
 * of an edit, and inside a tool trace it is raw JSON — offering to translate
 * either would be noise.
 */

/** Marks the region a selection must fall inside. Set by the thread. */
export const REPLY_ATTRIBUTE = 'data-assistant-reply';

/** Whole paragraphs are fine; a whole answer quoted back is not. */
const MAX_QUOTE = 1200;

interface Action {
  key: string;
  label: ChatKey;
  prompt: ChatKey;
  icon: React.ReactNode;
}

const ACTIONS: Action[] = [
  { key: 'explain', label: 'select.explain', prompt: 'select.explainPrompt', icon: <Sparkles className="size-3.5" /> },
  { key: 'shorten', label: 'select.shorten', prompt: 'select.shortenPrompt', icon: <Scissors className="size-3.5" /> },
  { key: 'translate', label: 'select.translate', prompt: 'select.translatePrompt', icon: <Languages className="size-3.5" /> },
  { key: 'remember', label: 'select.remember', prompt: 'select.rememberPrompt', icon: <BookMarked className="size-3.5" /> },
];

interface Spot {
  text: string;
  left: number;
  top: number;
}

/** The selection, but only when all of it sits inside one bot reply. */
function readSelection(): Spot | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

  const text = selection.toString().trim();
  if (text.length < 2) return null;

  const range = selection.getRangeAt(0);
  const inReply = (node: Node | null): boolean => {
    const element = node?.nodeType === Node.ELEMENT_NODE ? (node as Element) : node?.parentElement;
    return Boolean(element?.closest(`[${REPLY_ATTRIBUTE}]`));
  };
  // Both ends, so a drag that runs out of the reply into the next message
  // does not quote something the bot never said there.
  if (!inReply(range.startContainer) || !inReply(range.endContainer)) return null;

  const rect = range.getBoundingClientRect();
  if (!rect.width && !rect.height) return null;
  // Scrolled out of sight: without this the bar clamps to the edge and hangs
  // there over unrelated text, pointing at a selection nobody can see.
  if (rect.bottom < 0 || rect.top > window.innerHeight) return null;
  return { text, left: rect.left + rect.width / 2, top: rect.top };
}

export function SelectionActions({ onAsk }: { onAsk: (text: string) => void }) {
  const [spot, setSpot] = useState<Spot | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  // Measured, not assumed: the labels are translated, so the bar is a
  // different width in every language and a guessed half would push it off a
  // phone screen.
  const [half, setHalf] = useState(150);

  const refresh = useCallback(() => setSpot(readSelection()), []);

  useEffect(() => {
    // `selectionchange` fires mid-drag on every character, and a bar that
    // jumps under a moving cursor is unusable — so the bar is placed once the
    // pointer or the key is released.
    const onUp = () => window.setTimeout(refresh, 0);
    // Keyboard selection is shift+arrows or ctrl+A; re-reading on every keyup
    // is cheaper than guessing which combination was meant, because a keyup
    // with no selection inside a reply resolves to null anyway.
    const onKey = (event: KeyboardEvent) => (event.key === 'Escape' ? setSpot(null) : onUp());
    const onSelectionChange = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) setSpot(null);
    };
    /*
     * The bar is positioned in viewport coordinates, so a scroll would leave
     * it pointing at nothing. It follows the selection instead of hiding:
     * on a phone the act of selecting nudges the thread, and a toolbar that
     * vanishes the moment you reach for it is worse than none.
     */
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        refresh();
      });
    };
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchend', onUp);
    document.addEventListener('keyup', onKey);
    document.addEventListener('selectionchange', onSelectionChange);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchend', onUp);
      document.removeEventListener('keyup', onKey);
      document.removeEventListener('selectionchange', onSelectionChange);
      window.removeEventListener('scroll', onScroll, true);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [refresh]);

  useLayoutEffect(() => {
    if (bar.current) setHalf(bar.current.offsetWidth / 2);
  }, [spot]);

  if (!spot) return null;

  const quote = spot.text.length > MAX_QUOTE ? `${spot.text.slice(0, MAX_QUOTE)}…` : spot.text;
  // Keep the bar on screen at phone width, where a selection near the edge
  // would otherwise push half of it out of view.
  const edge = half + 8;
  const left = Math.min(Math.max(spot.left, edge), Math.max(edge, window.innerWidth - edge));
  const top = Math.max(spot.top - 46, 8);

  return createPortal(
    <div
      ref={bar}
      role="toolbar"
      aria-label={t('select.aria')}
      style={{ left, top, zIndex: 'var(--z-pop)' }}
      className="u-pop fixed flex -translate-x-1/2 items-center gap-0.5 rounded-md border border-line bg-surface p-1 shadow-pop"
      // Pressing a button must not clear the selection before the click lands.
      onMouseDown={(event) => event.preventDefault()}
    >
      {ACTIONS.map((action) => (
        <button
          key={action.key}
          type="button"
          // The label is hidden by CSS at phone width, which would leave the
          // button nameless to a screen reader.
          aria-label={t(action.label)}
          onClick={() => {
            onAsk(t(action.prompt, { text: quote }));
            window.getSelection()?.removeAllRanges();
            setSpot(null);
          }}
          className="flex h-7 items-center gap-1.5 rounded-sm px-2 text-[12px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent max-[759px]:h-9"
        >
          {action.icon}
          {/* Four translated labels do not fit a phone; the icons do. */}
          <span className="max-[759px]:hidden">{t(action.label)}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
}
