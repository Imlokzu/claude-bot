import {
  MarkdownTextPrimitive,
  type CodeHeaderProps,
  type SyntaxHighlighterProps,
} from '@assistant-ui/react-markdown';
import { Children, isValidElement, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import remarkGfm from 'remark-gfm';
import { DataTable, FileDiff, parseUnifiedDiff } from '@/vendor/aicss';
import { ChatGallery, ChatImage } from './Gallery';
import { remarkImageGroups } from './remarkImageGroups';
import { cn } from '@/lib/cn';

/*
 * Розмітка відповіді.
 *
 * Компоненти перевизначені всі до одного: типографіка чату — це не «стилі за
 * замовчуванням плюс трохи», а міра рядка, ритм списків і те, як виглядає код.
 * Саме тут видно, що панель хтось малював.
 */


/*
 * Таблиці й дифи малюються окремими компонентами з aicss.dev, а не тегами.
 *
 * Розмітка від моделі приходить звичайним markdown, тож тут вона
 * розбирається назад у дані: таблиця — у заголовки й рядки, блок ```diff —
 * у рядки з номерами. Це варте зусиль: у стрічці чату і те, і те — окремий
 * артефакт, який хочеться охопити оком, а не читати як абзац.
 */

/** Усі елементи заданого тегу серед дітей — на один рівень углиб. */
function tags(node: ReactNode, name: string): ReactElement<{ children?: ReactNode }>[] {
  const out: ReactElement<{ children?: ReactNode }>[] = [];
  Children.forEach(node, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === name) {
      out.push(child as ReactElement<{ children?: ReactNode }>);
      return;
    }
    out.push(...tags((child.props as { children?: ReactNode }).children, name));
  });
  return out;
}

/*
 * Картинка з розмітки.
 *
 * Окремим компонентом, а не інлайном, бо на нього дивиться ще й
 * перевизначення `p` нижче: щоб зібрати абзац із самих картинок у галерею,
 * треба впізнати їх серед дітей, а впізнати можна лише за типом елемента.
 */
function MdImage({ src, alt }: { src?: string; alt?: string }) {
  if (!src) return null;
  return <ChatImage src={src} alt={alt ?? ''} />;
}

/**
 * Картинки абзацу — або null, якщо там є ще щось, крім них.
 *
 * Порожні рядки між ними ігноруємо: markdown лишає між двома `![]()` на
 * сусідніх рядках текстовий вузол із самим переносом.
 */
function pictures(children: ReactNode): { src: string; alt: string }[] | null {
  const found: { src: string; alt: string }[] = [];
  let only = true;
  Children.forEach(children, (child) => {
    if (!only) return;
    if (typeof child === 'string') {
      if (child.trim()) only = false;
      return;
    }
    if (child === null || child === undefined || typeof child === 'boolean') return;
    if (isValidElement(child) && child.type === MdImage) {
      const props = child.props as { src?: string; alt?: string };
      if (props.src) found.push({ src: props.src, alt: props.alt ?? '' });
      return;
    }
    only = false;
  });
  return only && found.length > 0 ? found : null;
}

/*
 * Шапка блоку коду: мова + копіювання. assistant-ui віддає сюди готовий текст
 * фрагмента, тож копіюється саме код, а не те, що вдалось вишкребти з DOM.
 */
function CodeHeader({ language, code }: CodeHeaderProps) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  return (
    <div className="flex items-center justify-between rounded-t-md border border-b-0 border-line bg-surface-3 px-3 py-1.5">
      <span className="u-label text-[10px]">{language || 'код'}</span>
      <button
        type="button"
        onClick={copy}
        className="flex items-center gap-1.5 rounded-xs px-1.5 py-0.5 text-[11px] text-ink-3 transition-colors hover:text-ink"
      >
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        {copied ? 'Скопійовано' : 'Копіювати'}
      </button>
    </div>
  );
}

/*
 * Блок ```diff малюємо карткою змін (FileDiff з aicss.dev).
 *
 * Підключено через `componentsByLanguage` — власний механізм
 * assistant-ui для мов, які треба показати по-своєму. Спроба зловити диф у
 * перевизначенні `pre` не працює: до `pre` код доходить уже РЯДКОМ, без
 * елемента `<code class="language-diff">`, тож мову там просто нема з чого
 * дізнатись.
 *
 * Якщо текст не схожий на уніфікований диф (немає жодного шматка `@@`),
 * повертаємось до звичайного блоку коду: намалювати порожню картку зі
 * словом «diff» було б гірше, ніж показати те, що бот насправді написав.
 */
function DiffBlock({ components: { Pre, Code }, code }: SyntaxHighlighterProps) {
  const parsed = parseUnifiedDiff(code);
  if (!parsed) {
    return (
      <Pre>
        <Code>{code}</Code>
      </Pre>
    );
  }
  return (
    <div className="mb-3">
      <FileDiff file={parsed.file} rows={parsed.rows} />
    </div>
  );
}

// У картки дифа є власна шапка з іменем файлу та підрахунком «+/-»,
// тож загальну шапку блоку коду для цієї мови прибираємо.
const DIFF_LANGUAGE = {
  diff: { SyntaxHighlighter: DiffBlock, CodeHeader: () => null },
};

export function Markdown() {
  return (
    <MarkdownTextPrimitive
      /*
       * remark-gfm — без нього немає ТАБЛИЦЬ, закреслення й списків-чекбоксів:
       * базовий markdown їх не знає, і таблиця від бота приходила на екран
       * одним абзацом із паличками. Перевизначення `table` нижче без цього
       * плагіна просто ніколи не викликались.
       */
      remarkPlugins={[remarkGfm, remarkImageGroups]}
      componentsByLanguage={DIFF_LANGUAGE}
      className="text-[15px] leading-[1.62] text-ink"
      components={{
        img: MdImage,
        /*
         * Абзац із самих картинок — це не абзац, а набір: показуємо його
         * галереєю (одна — кадром, кілька — гармошкою) і без обгортки <p>,
         * інакше блокова картинка сидітиме всередині рядкового контексту.
         */
        p: ({ className, children, ...props }) => {
          const shots = pictures(children);
          if (shots && shots.length > 1) return <ChatGallery images={shots} />;
          if (shots) return <ChatImage {...shots[0]} />;
          return (
            <p className={cn('mb-3 last:mb-0', className)} {...props}>
              {children}
            </p>
          );
        },
        h1: ({ className, ...props }) => (
          <h1 className={cn('mb-2 mt-5 text-[19px] font-semibold tracking-[-0.015em] first:mt-0', className)} {...props} />
        ),
        h2: ({ className, ...props }) => (
          <h2 className={cn('mb-2 mt-5 text-[17px] font-semibold tracking-[-0.01em] first:mt-0', className)} {...props} />
        ),
        h3: ({ className, ...props }) => (
          <h3 className={cn('mb-1.5 mt-4 text-[15px] font-semibold first:mt-0', className)} {...props} />
        ),
        ul: ({ className, ...props }) => (
          <ul className={cn('mb-3 list-disc space-y-1 pl-5 marker:text-ink-3', className)} {...props} />
        ),
        ol: ({ className, ...props }) => (
          <ol className={cn('mb-3 list-decimal space-y-1 pl-5 marker:text-ink-3 marker:font-mono', className)} {...props} />
        ),
        a: ({ className, ...props }) => (
          <a className={cn('underline decoration-accent/40 underline-offset-2 hover:decoration-accent', className)}
             target="_blank" rel="noreferrer" {...props} />
        ),
        blockquote: ({ className, ...props }) => (
          <blockquote className={cn('my-3 border-l-2 border-accent/45 pl-3 text-ink-2', className)} {...props} />
        ),
        hr: ({ className, ...props }) => (
          <hr className={cn('my-5 border-line', className)} {...props} />
        ),
        table: ({ children }) => {
          const head = tags(children, 'th').map((cell) => (cell.props as { children?: ReactNode }).children);
          const rows = tags(children, 'tr')
            .map((row) => tags(row, 'td').map((cell) => (cell.props as { children?: ReactNode }).children))
            .filter((row) => row.length > 0);
          // Таблиця без заголовків або без рядків — не таблиця; краще нехай
          // її розбере далі звичайна розмітка, ніж показати порожню картку.
          if (head.length === 0 || rows.length === 0) return <>{children}</>;
          return (
            <div className="my-3 max-w-full overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:thin]">
              <DataTable columns={head} rows={rows} />
            </div>
          );
        },
        // Інлайновий код: тонка плашка, без рамки — інакше рядок рябіє.
        code: ({ className, ...props }) => (
          <code
            className={cn(
              'rounded-xs bg-surface-3 px-1 py-0.5 font-mono text-[0.88em] text-ink',
              // У блоці коду плашку знімаємо: там фон дає <pre>.
              'in-[pre]:bg-transparent in-[pre]:p-0 in-[pre]:text-[12.5px] in-[pre]:leading-[1.6]',
              className,
            )}
            {...props}
          />
        ),
        // Код прокручується всередині свого блоку — сторінка не їздить вбік.
        pre: ({ className, ...props }) => (
          <pre
            className={cn(
              'mb-3 overflow-x-auto rounded-b-md border border-line bg-surface-2 p-3',
              className,
            )}
            {...props}
          />
        ),
        CodeHeader,
      }}
    />
  );
}
