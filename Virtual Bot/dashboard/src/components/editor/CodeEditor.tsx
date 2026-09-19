import { useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { useTheme } from '@/hooks/useTheme';

/*
 * Редактор коду.
 *
 * Тему CodeMirror збираємо зі своїх токенів, а не беремо готову: чужа тема
 * приносить власну палітру, і редактор у теплій панелі виглядав би вставленим
 * з іншого застосунку.
 */

const LANGS: Record<string, () => ReturnType<typeof javascript>> = {
  js: () => javascript({ jsx: true }),
  jsx: () => javascript({ jsx: true }),
  ts: () => javascript({ jsx: true, typescript: true }),
  tsx: () => javascript({ jsx: true, typescript: true }),
  py: () => python() as never,
  json: () => json() as never,
  md: () => markdown() as never,
  html: () => html() as never,
  css: () => css() as never,
};

function extensionFor(path: string) {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const factory = LANGS[ext];
  return factory ? [factory()] : [];
}

export function CodeEditor({
  path,
  value,
  onChange,
  readOnly,
  className,
}: {
  path: string;
  value: string;
  onChange?: (next: string) => void;
  readOnly?: boolean;
  className?: string;
}) {
  const { resolved } = useTheme();

  const theme = useMemo(
    () =>
      EditorView.theme(
        {
          '&': {
            backgroundColor: 'var(--c-surface)',
            color: 'var(--c-text)',
            fontSize: '13px',
          },
          '.cm-content': { fontFamily: 'var(--f-mono)', caretColor: 'var(--c-accent)' },
          '.cm-gutters': {
            backgroundColor: 'var(--c-surface)',
            color: 'var(--c-text-3)',
            border: 'none',
            borderRight: '1px solid var(--c-border)',
          },
          '.cm-activeLine': { backgroundColor: 'var(--c-surface-2)' },
          '.cm-activeLineGutter': { backgroundColor: 'var(--c-surface-2)', color: 'var(--c-text-2)' },
          '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
            backgroundColor: 'var(--c-accent-soft)',
          },
          '.cm-cursor': { borderLeftColor: 'var(--c-accent)' },
          '&.cm-focused': { outline: 'none' },
        },
        { dark: resolved === 'dark' },
      ),
    [resolved],
  );

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      readOnly={readOnly}
      theme={theme}
      extensions={[...extensionFor(path), EditorView.lineWrapping]}
      basicSetup={{ foldGutter: false, highlightActiveLine: !readOnly }}
      className={className}
      height="100%"
    />
  );
}
