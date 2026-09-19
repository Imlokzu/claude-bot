"use client";

import styles from "./ThinkingReasoning.module.css";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

/*
 * Джерело: https://www.aicss.dev/r/thinking-reasoning.json (реєстр shadcn).
 *
 * Змінено: в оригіналі це демо — шість зашитих англійських речень, що
 * зʼявляються за таймером і через 5 с складаються в «Thought for 5s». Тут
 * рядки приходять пропсом і додаються тоді, коли бот РЕАЛЬНО щось зробив, а
 * час рахується від початку відповіді до її кінця. Інакше блок показував би
 * міркування там, де ніякого міркування не було.
 *
 * Геометрія, згортання, тіні-затемнення на краях і шимер — як в оригіналі.
 */

// Геометрія — має збігатися з CSS.
const SENT_H = 40; // 2 рядки × 20px
const GAP = 4;
const MAX_H = 180; // далі вікно не росте, а прокручується
const FADE = 16;

export interface ThinkingReasoningProps {
  /** Рядки того, що бот робить. Ростуть по ходу відповіді. */
  lines: ReactNode[];
  /** true — відповідь ще пишеться. */
  busy: boolean;
  /** Мітка процесу й підсумку: «Думаю…» / «Думав 6 с». */
  label?: string;
  doneLabel?: (seconds: number) => string;
  /** Показати ліворуч від мітки власний значок (у нас — LatticeLoader). */
  glyph?: ReactNode;
  className?: string;
}

export function ThinkingReasoning({
  lines,
  busy,
  label = "Думаю…",
  doneLabel = (s) => `Думав ${s} с`,
  glyph,
  className,
}: ThinkingReasoningProps) {
  const [open, setOpen] = useState(false);
  const [fade, setFade] = useState({ top: false, bottom: true });
  const [seconds, setSeconds] = useState(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const startedAt = useRef<number>(0);

  // Час рахуємо від першого «зайнято» і зупиняємо, коли відповідь дописана:
  // підсумок має називати справжню тривалість, а не заокруглення таймера.
  useEffect(() => {
    if (!busy) return undefined;
    startedAt.current = Date.now();
    setSeconds(0);
    const id = window.setInterval(
      () => setSeconds(Math.round((Date.now() - startedAt.current) / 1000)),
      250,
    );
    return () => {
      window.clearInterval(id);
      setSeconds(Math.max(1, Math.round((Date.now() - startedAt.current) / 1000)));
    };
  }, [busy]);

  const done = !busy;
  const expanded = done ? open : true;
  const count = lines.length;
  const contentH = count > 0 ? count * SENT_H + (count - 1) * GAP : 0;
  const capped = contentH > MAX_H;
  const viewH = capped ? MAX_H : contentH;
  const scrollable = done && open;
  const translate = scrollable ? 0 : capped ? MAX_H - FADE - contentH : 0;

  const showTop = scrollable ? fade.top : capped;
  const showBottom = scrollable ? fade.bottom : capped;
  const mask = capped
    ? `linear-gradient(to bottom, transparent 0, #000 ${showTop ? FADE : 0}px, #000 calc(100% - ${showBottom ? FADE : 0}px), transparent 100%)`
    : "none";

  const onScroll = () => {
    const el = viewportRef.current;
    if (!el) return;
    setFade({
      top: el.scrollTop > 1,
      bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 1,
    });
  };

  const toggle = () => {
    const next = !open;
    if (next) {
      setFade({ top: false, bottom: true });
      if (viewportRef.current) viewportRef.current.scrollTop = 0;
    }
    setOpen(next);
  };

  // Розгортати нема чого, якщо кроків не було: тоді лишається сама мітка.
  const canToggle = done && count > 0;

  return (
    <div className={styles.tr + (className ? " " + className : "")}>
      <button
        type="button"
        className={styles.trHeader + (canToggle ? " " + styles.isClickable : "")}
        aria-expanded={expanded}
        aria-label={canToggle ? "Показати, що робив бот" : undefined}
        onClick={canToggle ? toggle : undefined}
      >
        {glyph}
        {done ? (
          <span className={styles.trLabel}>{doneLabel(Math.max(1, seconds))}</span>
        ) : (
          <span className={styles.trLabel + " " + styles.trShimmer}>{label}</span>
        )}
        {canToggle && (
          <svg className={styles.trChevron} viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
            <path d="m4.5 15.75 7.5-7.5 7.5 7.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      <div className={styles.trCollapsible + (expanded ? "" : " " + styles.isCollapsed)}>
        <div className={styles.trInner}>
          <div
            ref={viewportRef}
            className={styles.trViewport + (scrollable ? " " + styles.isScroll : "")}
            style={{ height: `${viewH}px`, WebkitMaskImage: mask, maskImage: mask }}
            onScroll={scrollable ? onScroll : undefined}
          >
            <div className={styles.trStream} style={{ transform: `translateY(${translate}px)` }}>
              {lines.map((line, i) => (
                <p key={i} className={styles.trSentence}>{line}</p>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
