import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Input } from 'antd';

/**
 * Поле введення з ефектом «свіжого символа»: кожен новий надрукований символ
 * зʼявляється з блюру й трохи знизу, потім стає різким.
 *
 * Реальний <textarea> лишається робочим (курсор, виділення, IME, вставка) —
 * анімацію малює накладений шар-дублікат, який точно повторює геометрію
 * textarea. Сам текст у textarea стає прозорим, видно лише шар анімації.
 *
 * Якщо користувач просить зменшити рух (prefers-reduced-motion) — шар не
 * малюється, працює звичайний textarea.
 */

const FRESH_MS = 260; // скільки символ лишається «свіжим»

export default React.forwardRef(function BlurTypingInput(props, ref) {
  const { className, style, value, onChange, ...rest } = props;
  const innerRef = useRef(null);
  const overlayRef = useRef(null);
  const prevValueRef = useRef(typeof value === 'string' ? value : '');
  // Індекси символів, які щойно надруковані: Map<index, expiresAt>
  const [fresh, setFresh] = useState(() => new Map());
  const [reduceMotion, setReduceMotion] = useState(false);
  const timerRef = useRef(0);

  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReduceMotion(mq.matches);
    apply();
    mq.addEventListener?.('change', apply);
    return () => mq.removeEventListener?.('change', apply);
  }, []);

  const text = typeof value === 'string' ? value : '';

  // Визначаємо, які саме символи додались (лише дописування в кінець або
  // вставка всередину — порівнюємо спільний префікс/суфікс).
  useEffect(() => {
    const prev = prevValueRef.current;
    prevValueRef.current = text;
    if (reduceMotion || text.length <= prev.length) {
      if (text.length < prev.length && fresh.size) setFresh(new Map());
      return;
    }
    let start = 0;
    const max = Math.min(prev.length, text.length);
    while (start < max && prev[start] === text[start]) start += 1;
    let end = 0;
    while (
      end < max - start &&
      prev[prev.length - 1 - end] === text[text.length - 1 - end]
    ) {
      end += 1;
    }
    const addedFrom = start;
    const addedTo = text.length - end; // [addedFrom, addedTo)
    if (addedTo <= addedFrom) return;
    const expiresAt = performance.now() + FRESH_MS;
    setFresh((prevMap) => {
      const next = new Map(prevMap);
      // Зсуваємо старі індекси, якщо вставка була не в кінець
      const shift = addedTo - addedFrom;
      if (addedFrom < prev.length) {
        for (const [idx, exp] of prevMap) {
          if (idx >= addedFrom) {
            next.delete(idx);
            next.set(idx + shift, exp);
          }
        }
      }
      for (let i = addedFrom; i < addedTo; i += 1) next.set(i, expiresAt);
      return next;
    });
  }, [text, reduceMotion]);

  /* Знімаємо «свіжість» після завершення анімації.
     ВАЖЛИВО: чекаємо рівно до НАЙПІЗНІШОГО expiry й одразу чистим
     усе. Якщо би ми опитували стан короткими тіками, то тік без змін
     повернув би той самий Map → без ре-рендеру ефект не перезапуститься
     і шар анімації завис би навічно. */
  useEffect(() => {
    if (!fresh.size) return undefined;
    let maxExp = 0;
    for (const exp of fresh.values()) maxExp = Math.max(maxExp, exp);
    const delay = Math.max(0, maxExp - performance.now()) + 20;
    timerRef.current = window.setTimeout(() => {
      const now = performance.now();
      setFresh((prevMap) => {
        const next = new Map();
        for (const [idx, exp] of prevMap) if (exp > now) next.set(idx, exp);
        return next.size === prevMap.size ? prevMap : next;
      });
    }, delay);
    return () => window.clearTimeout(timerRef.current);
  }, [fresh]);

  /* Шар анімації мусить бути ПІКСЕЛЬ В ПІКСЕЛЬ з textarea, інакше текст
     «стрибатиме» при вкл/викл анімації. Копіюємо реальні обчислені
     метрики шрифта та падінги (inherit не достатньо — antd ставить їх
     на самому textarea, а не на обгортці). */
  const syncOverlay = () => {
    const ta = innerRef.current?.resizableTextArea?.textArea;
    const ov = overlayRef.current;
    if (!ta || !ov) return;
    const cs = window.getComputedStyle(ta);
    for (const prop of [
      'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight',
      'letterSpacing', 'wordSpacing', 'textIndent', 'textTransform',
      'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
      'tabSize',
    ]) {
      ov.style[prop] = cs[prop];
    }
    ov.scrollTop = ta.scrollTop;
    ov.scrollLeft = ta.scrollLeft;
  };

  const active = !reduceMotion && fresh.size > 0;

  useLayoutEffect(syncOverlay, [text, active]);

  /* Розбиваємо текст на «свіжі» і звичайні відрізки.
     Ідемо за символами-code points (for..of), але ключі fresh — це UTF-16
     індекси (так рахує diff вище), тому тримаємо окремий лічильник —
     інакше емодзі (сурогатні пари) збивали б підсвітку.
     Сусідні символи однакового типу групуємо, щоб не плодити тисячі вузлів. */
  const segments = [];
  if (active) {
    let unit = 0;
    let buf = '';
    let bufFresh = false;
    for (const ch of text) {
      const isFresh = fresh.has(unit);
      if (buf !== '' && isFresh !== bufFresh) {
        segments.push({ text: buf, fresh: bufFresh, at: unit - buf.length });
        buf = '';
      }
      bufFresh = isFresh;
      buf += ch;
      unit += ch.length;
    }
    if (buf !== '') segments.push({ text: buf, fresh: bufFresh, at: unit - buf.length });
  }

  return (
    <div className="blur-typing-wrap">
      <Input.TextArea
        {...rest}
        ref={(node) => {
          innerRef.current = node;
          if (typeof ref === 'function') ref(node);
          else if (ref) ref.current = node;
        }}
        value={value}
        onChange={onChange}
        onScroll={(e) => {
          syncOverlay();
          rest.onScroll?.(e);
        }}
        className={[className, active ? 'blur-typing-hidden-text' : '']
          .filter(Boolean)
          .join(' ')}
        style={style}
      />
      {active && (
        <div ref={overlayRef} className="blur-typing-overlay" aria-hidden="true">
          {segments.map((seg) =>
            seg.fresh ? (
              <span className="blur-typing-char" key={`f-${seg.at}`}>
                {seg.text}
              </span>
            ) : (
              <React.Fragment key={`p-${seg.at}`}>{seg.text}</React.Fragment>
            )
          )}
        </div>
      )}
    </div>
  );
});
