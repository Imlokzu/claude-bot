import { isValidElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { animate, useMotionValue, useMotionValueEvent, useReducedMotion } from 'motion/react';
import { HugeiconsIcon } from './_icons.jsx';
import {
  ArrowDown01Icon,
  Attachment01Icon,
  Calendar03Icon,
  Cancel01Icon,
  ChartLineData01Icon,
  File02Icon,
  Globe02Icon,
  HelpCircleIcon,
  Mail01Icon,
  Mic01Icon,
  PlusSignIcon,
  SparklesIcon,
  Tick02Icon
} from './_icons.jsx';
import './PromptBar.css';

/*
 * ПРАВКИ в цьому файлі (дві, обидві позначені тут, щоб не загубились при
 * оновленні з reactbits.dev):
 *
 * 6) `modelSlot` — what to render in place of the model and effort
 *    pickers. The vendor list has no search and keeps the catalog's own
 *    order, which stopped working at sixty models; our ModelMenu (search,
 *    makers, recent picks, thinking level) takes the spot instead. Pass
 *    `models={[]}` and `efforts={[]}` with it so the vendor pickers stay
 *    hidden.
 *
 * 5) `controlRef` — a way to add attachments from outside the bar. On a
 *    phone the "+" opens our own sheet (camera, photos, files) instead of
 *    the vendor's source list, and the files it picks must land in the
 *    same chip row the bar sends with. The attachment list is internal
 *    state with no prop for it, so the bar hands out an `addAttachments`
 *    function through this ref.
 *
 * 4) `onDictateStop` — людина натиснула мікрофон удруге, тобто договорила.
 *    Свого «стоп» компонент не мав узагалі: повторний натиск просто кидав
 *    обіцянку, мікрофон лишався відкритим до кінця фрази, а сказане
 *    зникало. Тепер натиск закриває фразу й відправляє її на розпізнавання.
 *
 * 3) `labels` — підписи панелі рівня зусилля. У вендора вони зашиті в
 *    розмітку («Effort», «Faster», «Smarter»), і серед української панелі
 *    це виглядало як недороблене місце. Підміняти їх через CSS `content`
 *    не можна: текст лишився б англійським для зчитувачів екрана.
 *
 * 2) `plusSlot` — чим замінити кнопку «+». Вона у вендора відкриває список
 *    джерел випадайкою; у нас на її місці радіальне меню (bencho.dev), де
 *    натиск, вибір і підтвердження — один жест. Пропса під заміну кнопки
 *    компонент не має, а домальовувати її поверх означало б тримати дві
 *    кнопки в одному місці.
 *
 * 1) `onModelChange`.
 *
 * Компонент повідомляє про зміну рівня зусилля (`onEffortChange`), але про
 * зміну моделі — ні: вона їде лише в meta разом із надісланим текстом. Нам
 * цього замало, бо від моделі залежить розмір вікна контексту, а він
 * показаний ПІД полем вводу й має оновитись одразу після вибору, а не аж
 * після наступної репліки.
 *
 * Позначено тут, щоб при оновленні з reactbits.dev правку не загубити.
 */

const ARROW_UP = [12, 4.5, 18.5, 11, 14.25, 11, 14.25, 19.5, 9.75, 19.5, 9.75, 11, 5.5, 11];
const SQUARE = [12, 6, 18, 6, 18, 12, 18, 18, 6, 18, 6, 12, 6, 6];
const EASE_IN_OUT = [0.77, 0, 0.175, 1];
const LINE = 22;
const EDGE = 11;

const DEFAULT_SOURCES = [
  {
    key: 'files',
    name: 'Photos & files',
    description: 'Upload from this device',
    icon: Attachment01Icon,
    attach: true
  },
  { key: 'web', name: 'Web search', description: 'Live results', icon: Globe02Icon },
  { key: 'sales', name: 'Sales data', description: 'Revenue and churn', icon: ChartLineData01Icon },
  { key: 'docs', name: 'Documents', description: 'Specs, notes, briefs', icon: File02Icon },
  { key: 'mail', name: 'Mail', description: 'Read and draft mail', icon: Mail01Icon },
  { key: 'calendar', name: 'Calendar', description: 'Events and availability', icon: Calendar03Icon }
];
const DEFAULT_COMMANDS = [
  { key: 'summarize', name: '/summarize', description: 'Digest the thread so far' },
  { key: 'compare', name: '/compare', description: 'Two options side by side' },
  { key: 'draft', name: '/draft', description: 'Write a first version' },
  { key: 'explain', name: '/explain', description: 'A plain-language walkthrough' },
  { key: 'tasks', name: '/tasks', description: 'Turn this into a to-do list' }
];
const DEFAULT_MODELS = [
  { key: 'nova-3', name: 'Nova 3', tag: 'Flagship' },
  { key: 'nova-mini', name: 'Nova Mini', tag: 'Fast' },
  { key: 'nova-2', name: 'Nova 2', tag: 'Legacy' }
];
const DEFAULT_EFFORTS = ['Low', 'Medium', 'High', 'Extra', 'Max'];

const mix = (a, b, t) => a + (b - a) * t;
const pathAt = (a, b, t) => {
  let d = '';
  for (let i = 0; i < a.length; i += 2) {
    d += `${i ? 'L' : 'M'}${mix(a[i], b[i], t).toFixed(2)} ${mix(a[i + 1], b[i + 1], t).toFixed(2)}`;
  }
  return `${d}Z`;
};

const parseToken = draft => {
  const m = /(^|\s)([@/])([\w-]*)$/.exec(draft);
  if (!m) return null;
  return { kind: m[2] === '@' ? 'at' : 'slash', query: m[3].toLowerCase(), start: m.index + m[1].length };
};

const renderIcon = (icon, size) =>
  isValidElement(icon) ? icon : <HugeiconsIcon icon={icon} size={size} strokeWidth={1.8} />;

const attachmentName = file =>
  typeof file === 'string' ? file : String(file?.name || file?.filename || 'Вкладення');

function SendGlyph({ busy, morphDuration, squash, tilt }) {
  const reduce = useReducedMotion();
  const svgRef = useRef(null);
  const pathRef = useRef(null);
  const dir = useRef(busy ? 1 : -1);
  const t = useMotionValue(busy ? 1 : 0);

  useEffect(() => {
    const target = busy ? 1 : 0;
    dir.current = busy ? 1 : -1;
    if (t.get() === target) return undefined;
    const controls = animate(
      t,
      target,
      reduce ? { duration: 0 } : { duration: morphDuration / 1000, ease: EASE_IN_OUT }
    );
    return () => controls.stop();
  }, [busy, morphDuration, reduce, t]);

  useMotionValueEvent(t, 'change', v => {
    pathRef.current?.setAttribute('d', pathAt(ARROW_UP, SQUARE, v));
    const goo = reduce ? 0 : Math.sin(v * Math.PI);
    const sx = 1 - squash * goo;
    if (svgRef.current) {
      svgRef.current.style.transform = goo ? `rotate(${dir.current * tilt * goo}deg) scale(${sx}, ${1 / sx})` : '';
    }
  });

  return (
    <svg
      ref={svgRef}
      className="prompt-bar__glyph"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    >
      <path ref={pathRef} d={pathAt(ARROW_UP, SQUARE, t.get())} />
    </svg>
  );
}

export default function PromptBar({
  placeholder = 'Ask anything',
  sources = DEFAULT_SOURCES,
  commands = DEFAULT_COMMANDS,
  models = DEFAULT_MODELS,
  defaultModel = '',
  efforts = DEFAULT_EFFORTS,
  defaultEffort = '',
  onEffortChange,
  onModelChange,
  plusSlot,
  modelSlot,
  controlRef,
  labels,
  onDictateStop,
  busy = false,
  onSend,
  onStop,
  onAttach,
  onDictate,
  background = '#27272a',
  color = '#f5f5f5',
  menuBackground = '#323236',
  sparkColor = '#b39dff',
  width = 400,
  radius = 16,
  maxRows = 5,
  morphDuration = 240,
  squash = 0.12,
  tilt = 8,
  pressScale = 0.96,
  className = ''
}) {
  const reduce = useReducedMotion();
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const glowRef = useRef(null);
  const sparkRef = useRef(null);
  const rowRefs = useRef([]);
  const lastOpen = useRef(null);
  const dictation = useRef(0);
  const latest = useRef({});
  latest.current = { onSend, onStop, onAttach, onDictate, onEffortChange, onModelChange, onDictateStop };

  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [modelKey, setModelKey] = useState(defaultModel);
  const [plusOpen, setPlusOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [effortOpen, setEffortOpen] = useState(false);
  const [effortIndex, setEffortIndex] = useState(() => {
    const i = efforts.indexOf(defaultEffort);
    return i >= 0 ? i : Math.max(0, Math.floor((efforts.length - 1) / 2));
  });
  const [dismissed, setDismissed] = useState(false);
  const menuOpenRef = useRef(false);
  /* На тачі меню відкриваємо на pointerdown (до того, як blur клавіатури
     може проковтнути click). Click одразу після того самого дотику треба
     пропустити — інакше меню відкриється й одразу закриється. */
  const touchOpenedRef = useRef(0);
  const [active, setActive] = useState(0);
  const [listening, setListening] = useState(false);
  const [pressed, setPressed] = useState(false);

  /* Edit 5: see the header. Assigned during render so the handle exists
     before any parent effect can call it. */
  if (controlRef) {
    controlRef.current = {
      addAttachments: files => {
        const list = Array.isArray(files) ? files : [files];
        if (list.length) setAttachments(a => [...a, ...list]);
      }
    };
  }

  const model = models.find(m => m.key === modelKey) ?? models[0];
  const token = dismissed ? null : parseToken(draft);
  const open = plusOpen ? 'at' : (token?.kind ?? (modelOpen ? 'model' : effortOpen ? 'effort' : null));
  menuOpenRef.current = open !== null;

  /* Закриття з рухом: компонент раніше знімав меню з DOM тієї ж миті, і
     анімувати зникнення було нічим. Тепер, коли `open` стає null, меню
     лишається змонтованим ще 180 мс у стані `closing` — CSS дограє
     scale-down, і лише тоді воно зникає. Під час closing меню не реагує
     на вказівник. */
  const [closing, setClosing] = useState(null);
  const closeTimer = useRef(0);
  const prevOpen = useRef(null);
  useEffect(() => {
    if (open) {
      clearTimeout(closeTimer.current);
      prevOpen.current = open;
      setClosing(null);
      return undefined;
    }
    if (prevOpen.current) {
      const kind = prevOpen.current;
      prevOpen.current = null;
      setClosing(kind);
      clearTimeout(closeTimer.current);
      closeTimer.current = setTimeout(() => setClosing(null), 180);
    }
    return undefined;
  }, [open]);
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  const shown = open ?? closing;
  const query = plusOpen ? '' : (token?.query ?? '');
  const list = useMemo(() => {
    if (open === 'at') return sources.filter(s => s.name.toLowerCase().includes(query));
    if (open === 'slash') return commands.filter(c => c.name.replace(/^\//, '').toLowerCase().startsWith(query));
    if (open === 'model') return models;
    return [];
  }, [open, query, sources, commands, models]);
  const cursor = Math.min(active, Math.max(0, list.length - 1));
  const canSend = draft.trim().length > 0 || attachments.length > 0;
  const armed = busy || canSend;
  const level = efforts[effortIndex] ?? '';
  const maxed = efforts.length > 1 && effortIndex === efforts.length - 1;

  const [coarse, setCoarse] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches,
  );
  useEffect(() => {
    const media = window.matchMedia('(pointer: coarse)');
    const update = () => setCoarse(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const focusInput = () => inputRef.current?.focus({ preventScroll: true });
  /* На тачі меню відкриваємо без фокуса — клавіатура не потрібна для
     вибору пункту й лише перекриває список. На десктопі фокус лишається:
     стрілки/Enter одразу працюють. */
  const focusInputKeysOnly = () => {
    if (!coarse) focusInput();
  };
  const closeMenus = useCallback(() => {
    setPlusOpen(false);
    setModelOpen(false);
    setEffortOpen(false);
  }, []);

  useLayoutEffect(() => {
    const glow = glowRef.current;
    if (!glow || !open) return;
    const row = rowRefs.current[cursor];
    if (!row) {
      glow.style.opacity = '0';
      return;
    }
    const fresh = lastOpen.current !== open;
    lastOpen.current = open;
    if (fresh) glow.style.transition = 'none';
    glow.style.top = `${row.offsetTop}px`;
    glow.style.height = `${row.offsetHeight}px`;
    glow.style.opacity = '1';
    if (fresh) {
      void glow.offsetHeight;
      glow.style.transition = '';
    }
  }, [open, cursor, list]);
  useEffect(() => {
    if (!open) lastOpen.current = null;
  }, [open]);

  useEffect(() => {
    if (!plusOpen && !modelOpen && !effortOpen) return undefined;
    const onDown = e => {
      if (!rootRef.current?.contains(e.target)) closeMenus();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [plusOpen, modelOpen, effortOpen, closeMenus]);

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = '0px';
    const max = LINE * maxRows;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }, [draft, maxRows]);

  useEffect(
    () => () => {
      dictation.current += 1;
    },
    []
  );

  useEffect(() => {
    const canvas = sparkRef.current;
    if (!maxed || reduce || !canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    let raf = 0;
    let last = performance.now();
    let w = 0;
    let h = 0;
    let due = 0;
    const parts = [];
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const spawn = burst => {
      parts.push({
        x: Math.random() * w,
        y: burst ? h * (0.2 + Math.random() * 0.8) : h + 3,
        r: 0.9 + Math.random() * 1.1,
        vy: -(7 + Math.random() * 9),
        sway: (Math.random() - 0.5) * 10,
        phase: Math.random() * Math.PI * 2,
        life: burst ? Math.random() * 1.2 : 0,
        span: 2.4 + Math.random() * 2.4
      });
    };
    const tick = now => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      due += dt;
      while (due > 0.14) {
        due -= 0.14;
        if (parts.length < 30) spawn(false);
      }
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = sparkColor;
      ctx.shadowColor = sparkColor;
      ctx.shadowBlur = 6;
      for (let i = parts.length - 1; i >= 0; i -= 1) {
        const p = parts[i];
        p.life += dt;
        if (p.life > p.span) {
          parts.splice(i, 1);
          continue;
        }
        const k = p.life / p.span;
        const twinkle = 0.7 + 0.3 * Math.sin(now / 160 + p.phase);
        p.y += p.vy * dt;
        ctx.globalAlpha = Math.sin(k * Math.PI) * 0.9 * twinkle;
        ctx.beginPath();
        ctx.arc(p.x + Math.sin(now / 900 + p.phase) * p.sway, p.y, p.r * twinkle, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    resize();
    for (let i = 0; i < 26; i += 1) spawn(true);
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      ctx.clearRect(0, 0, w, h);
    };
  }, [maxed, reduce, sparkColor]);

  const setEffort = i => {
    const next = Math.max(0, Math.min(efforts.length - 1, i));
    if (next === effortIndex) return;
    setEffortIndex(next);
    latest.current.onEffortChange?.(efforts[next]);
  };
  const effortFromPointer = e => {
    const rect = e.currentTarget.getBoundingClientRect();
    const k = (e.clientX - rect.left - EDGE) / Math.max(1, rect.width - 2 * EDGE);
    setEffort(Math.round(k * (efforts.length - 1)));
  };
  const onEffortKey = e => {
    const step =
      e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
    if (step) {
      e.preventDefault();
      setEffort(effortIndex + step);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setEffort(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setEffort(efforts.length - 1);
    } else if (e.key === 'Escape') {
      setEffortOpen(false);
      focusInput();
    }
  };
  const stepAt = i => `calc(${EDGE}px + (100% - ${EDGE * 2}px) * ${i / Math.max(1, efforts.length - 1)})`;
  const fillAt = i => (i === efforts.length - 1 ? '100%' : `calc(${stepAt(i)} + 7px)`);

  const pick = row => {
    if (open === 'model') {
      setModelKey(row.key);
      setModelOpen(false);
      if (row.key !== modelKey) latest.current.onModelChange?.(row.key);
      focusInputKeysOnly();
      return;
    }
    const head = token ? draft.slice(0, token.start) : draft;
    if (row.attach) {
      setDraft(head);
      Promise.resolve(latest.current.onAttach?.()).then(files => {
        if (!files) return;
        setAttachments(a => [...a, ...(Array.isArray(files) ? files : [files])]);
      });
    } else if (open === 'at') {
      setDraft(`${head}@${row.name} `);
    } else {
      setDraft(`${head}${row.name} `);
    }
    setPlusOpen(false);
    setDismissed(false);
    focusInputKeysOnly();
  };

  const send = () => {
    if (!canSend || busy) return;
    latest.current.onSend?.(draft.trim(), { attachments, model, effort: level });
    setDraft('');
    setAttachments([]);
    setDismissed(false);
    closeMenus();
    focusInputKeysOnly();
  };

  const toggleListen = () => {
    if (listening) {
      // Другий натиск = «я договорив», а не «забудь». Номер сесії тут НЕ
      // рухаємо і слухання не гасимо: обіцянка з першого натиску ще жива,
      // і саме вона принесе розпізнаний текст. Той, хто пише звук, лише
      // отримує сигнал закінчити фразу й віддати її на розпізнавання.
      latest.current.onDictateStop?.();
      return;
    }
    const seq = ++dictation.current;
    setListening(true);
    Promise.resolve(latest.current.onDictate?.()).then(
      text => {
        if (seq !== dictation.current) return;
        setListening(false);
        if (text) setDraft(d => (d.trim() ? `${d.trimEnd()} ${text}` : text));
        focusInput();
      },
      () => {
        if (seq === dictation.current) setListening(false);
      }
    );
  };

  const onKeyDown = e => {
    if (open && list.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((cursor + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length);
        return;
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault();
        pick(list[cursor]);
        return;
      }
    }
    if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setDismissed(true);
        closeMenus();
      }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const down = e => {
    if (e.button !== 0 || !armed) return;
    setPressed(true);
  };
  const up = () => setPressed(false);

  return (
    <div
      ref={rootRef}
      className={`prompt-bar${className ? ` ${className}` : ''}`}
      data-busy={busy ? '' : undefined}
      data-max={maxed ? '' : undefined}
      style={{
        '--pb-bg': background,
        '--pb-ink': color,
        '--pb-menu': menuBackground,
        '--pb-w': `${width}px`,
        '--pb-radius': `${radius}px`,
        '--pb-spark': sparkColor,
        '--pb-press': pressScale
      }}
    >
      {shown ? (
        <div
          className={`prompt-bar__menu${coarse ? ' prompt-bar__menu--vv' : ''}`}
          role={shown === 'effort' ? 'dialog' : 'listbox'}
          aria-label={
            shown === 'at'
              ? (labels?.sources ?? 'Sources')
              : shown === 'slash'
                ? (labels?.commands ?? 'Commands')
                : shown === 'model'
                  ? (labels?.models ?? 'Models')
                  : (labels?.effort ?? 'Effort')
          }
          data-kind={shown}
          data-state={open ? 'open' : 'closed'}
        >
          {shown === 'effort' ? (
            <>
              <div className="prompt-bar__effort-head">
                <span className="prompt-bar__effort-title">{labels?.effort ?? 'Effort'}</span>
                <span className="prompt-bar__effort-level">{level}</span>
                <span className="prompt-bar__effort-help" title={labels?.effortHint ?? 'Higher effort thinks longer before answering'}>
                  <HugeiconsIcon icon={HelpCircleIcon} size={14} strokeWidth={1.8} />
                </span>
              </div>
              <div className="prompt-bar__effort-ends">
                <span>{labels?.faster ?? 'Faster'}</span>
                <span>{labels?.smarter ?? 'Smarter'}</span>
              </div>
              <div
                className="prompt-bar__effort-track"
                role="slider"
                tabIndex={0}
                aria-label={labels?.effort ?? 'Effort'}
                aria-valuemin={0}
                aria-valuemax={efforts.length - 1}
                aria-valuenow={effortIndex}
                aria-valuetext={level}
                style={{ '--pb-effort-x': stepAt(effortIndex), '--pb-effort-fill': fillAt(effortIndex) }}
                onPointerDown={e => {
                  if (e.button !== 0) return;
                  try {
                    e.currentTarget.setPointerCapture(e.pointerId);
                  } catch {}
                  e.currentTarget.focus({ preventScroll: true });
                  effortFromPointer(e);
                }}
                onPointerMove={e => {
                  if (e.buttons & 1) effortFromPointer(e);
                }}
                onKeyDown={onEffortKey}
              >
                <span className="prompt-bar__effort-fill" />
                {efforts.map((label, i) => (
                  <i key={label} className="prompt-bar__effort-dot" style={{ left: stepAt(i) }} />
                ))}
                <span className="prompt-bar__effort-thumb" />
              </div>
            </>
          ) : (
            <>
              <span ref={glowRef} className="prompt-bar__glow" aria-hidden="true" />
              {list.map((row, i) => (
                <button
                  key={row.key}
                  ref={el => {
                    rowRefs.current[i] = el;
                  }}
                  type="button"
                  role="option"
                  aria-selected={i === cursor}
                  className="prompt-bar__row"
                  onMouseDown={e => { if (!coarse) e.preventDefault(); }}
                  onPointerEnter={() => setActive(i)}
                  onClick={() => {
                    /* Той самий дотик, що відкрив меню, не повинен одразу
                       вибирати пункт під пальцем. */
                    if (Date.now() - touchOpenedRef.current < 500) return;
                    pick(row);
                  }}
                >
                  {shown === 'at' ? <span className="prompt-bar__row-icon">{renderIcon(row.icon, 15)}</span> : null}
                  <span className="prompt-bar__row-name">{row.name}</span>
                  {row.description ? <span className="prompt-bar__row-desc">{row.description}</span> : null}
                  {shown === 'model' ? (
                    <>
                      <span className="prompt-bar__row-tag">{row.tag}</span>
                      <span className="prompt-bar__row-check" data-on={row.key === model?.key ? '' : undefined}>
                        <HugeiconsIcon icon={Tick02Icon} size={13} strokeWidth={2.5} />
                      </span>
                    </>
                  ) : null}
                </button>
              ))}
              {list.length === 0 ? <div className="prompt-bar__empty">No matches for “{query}”</div> : null}
            </>
          )}
        </div>
      ) : null}

      <div
        className="prompt-bar__field"
        role="presentation"
        data-max={maxed ? '' : undefined}
        onPointerDown={e => {
          if (e.target === e.currentTarget || e.target === inputRef.current) closeMenus();
        }}
        onClick={e => {
          /* Клавіатуру піднімає лише дотик по самому текстовому полю —
             клік по пустій зоні навколо рядка кнопок не повинен її
             відкривати, інакше кожен промах перетворювався на клаву. */
          if (e.target === e.currentTarget || e.target === inputRef.current) focusInput();
        }}
      >
        <canvas ref={sparkRef} className="prompt-bar__sparks" aria-hidden="true" />
        {attachments.length > 0 ? (
          <div className="prompt-bar__chips">
            {attachments.map((file, i) => {
              const name = attachmentName(file);
              return (
              <span key={`${name}-${i}`} className="prompt-bar__chip">
                <HugeiconsIcon icon={File02Icon} size={12} strokeWidth={2} />
                <span className="prompt-bar__chip-name">{name}</span>
                <button
                  type="button"
                  className="prompt-bar__chip-x"
                  aria-label={`Remove ${name}`}
                  onClick={() => setAttachments(a => a.filter((_, j) => j !== i))}
                >
                  <HugeiconsIcon icon={Cancel01Icon} size={10} strokeWidth={2.5} />
                </button>
              </span>
              );
            })}
          </div>
        ) : null}

        <textarea
          ref={inputRef}
          className="prompt-bar__input"
          rows={1}
          value={draft}
          placeholder={listening ? (labels?.listening ?? 'Listening…') : placeholder}
          aria-label={labels?.prompt ?? 'Prompt'}
          onChange={e => {
            setDraft(e.target.value);
            setDismissed(false);
            closeMenus();
            setActive(0);
          }}
          onFocus={closeMenus}
          onKeyDown={onKeyDown}
        />

        <div className="prompt-bar__bar">
          {plusSlot !== undefined ? plusSlot : (
          <button
            type="button"
            className="prompt-bar__tool"
            aria-label={labels?.add ?? 'Add files and sources'}
            aria-expanded={plusOpen}
            data-on={plusOpen ? '' : undefined}
            onMouseDown={e => { if (!coarse) e.preventDefault(); }}
            onPointerDown={e => {
              if (e.pointerType !== 'touch') return;
              touchOpenedRef.current = Date.now();
              setModelOpen(false);
              setEffortOpen(false);
              setActive(0);
              setPlusOpen(v => !v);
            }}
            onClick={() => {
              if (Date.now() - touchOpenedRef.current < 500) return;
              setModelOpen(false);
              setEffortOpen(false);
              setActive(0);
              setPlusOpen(v => !v);
              focusInputKeysOnly();
            }}
          >
            <HugeiconsIcon icon={PlusSignIcon} size={16} strokeWidth={2} />
          </button>
          )}
          {modelSlot}
          {models.length > 0 ? (
            <button
              type="button"
              className="prompt-bar__pick"
              aria-label={labels?.chooseModel ?? 'Choose model'}
              aria-expanded={modelOpen}
              data-on={modelOpen ? '' : undefined}
              onMouseDown={e => { if (!coarse) e.preventDefault(); }}
              onPointerDown={e => {
                if (e.pointerType !== 'touch') return;
                touchOpenedRef.current = Date.now();
                setPlusOpen(false);
                setEffortOpen(false);
                setActive(Math.max(0, models.indexOf(model)));
                setModelOpen(v => !v);
              }}
              onClick={() => {
                if (Date.now() - touchOpenedRef.current < 500) return;
                setPlusOpen(false);
                setEffortOpen(false);
                setActive(Math.max(0, models.indexOf(model)));
                setModelOpen(v => !v);
                focusInputKeysOnly();
              }}
            >
              <span>{model.name}</span>
              <HugeiconsIcon icon={ArrowDown01Icon} size={12} strokeWidth={2.4} />
            </button>
          ) : null}
          {efforts.length > 0 ? (
            <button
              type="button"
              className="prompt-bar__pick"
              aria-label={labels?.chooseEffort ?? 'Choose effort'}
              aria-expanded={effortOpen}
              data-on={effortOpen ? '' : undefined}
              data-max={maxed ? '' : undefined}
              onMouseDown={e => { if (!coarse) e.preventDefault(); }}
              onPointerDown={e => {
                if (e.pointerType !== 'touch') return;
                touchOpenedRef.current = Date.now();
                setPlusOpen(false);
                setModelOpen(false);
                setEffortOpen(v => !v);
              }}
              onClick={() => {
                if (Date.now() - touchOpenedRef.current < 500) return;
                setPlusOpen(false);
                setModelOpen(false);
                setEffortOpen(v => !v);
                focusInputKeysOnly();
              }}
            >
              <HugeiconsIcon icon={SparklesIcon} size={13} strokeWidth={2} />
              <span>{level}</span>
            </button>
          ) : null}
          <span className="prompt-bar__spacer" />
          {onDictate ? (
            <button
              type="button"
              className="prompt-bar__tool"
              aria-label={listening ? (labels?.stopDictation ?? 'Stop dictation') : (labels?.dictate ?? 'Dictate')}
              aria-pressed={listening}
              data-on={listening ? '' : undefined}
              onMouseDown={e => { if (!coarse) e.preventDefault(); }}
              onClick={toggleListen}
            >
              {listening ? (
                <span className="prompt-bar__eq" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
              ) : (
                <HugeiconsIcon icon={Mic01Icon} size={15} strokeWidth={2} />
              )}
            </button>
          ) : null}
          <button
            type="button"
            className="prompt-bar__send"
            disabled={!armed}
            aria-label={busy ? (labels?.stop ?? 'Stop') : (labels?.send ?? 'Send')}
            data-armed={armed ? '' : undefined}
            data-pressed={pressed ? '' : undefined}
            onMouseDown={e => { if (!coarse) e.preventDefault(); }}
            onPointerDown={down}
            onPointerUp={up}
            onPointerCancel={up}
            onPointerLeave={up}
            onClick={() => {
              if (busy) latest.current.onStop?.();
              else send();
            }}
          >
            <SendGlyph busy={busy} morphDuration={morphDuration} squash={squash} tilt={tilt} />
          </button>
        </div>
      </div>
    </div>
  );
}
