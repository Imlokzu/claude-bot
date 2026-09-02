import React, { useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { markdown } from '@codemirror/lang-markdown';
import { json } from '@codemirror/lang-json';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';

/**
 * Міні-редактор на CodeMirror 6 — один компонент і для перегляду вставленого
 * тексту, і для файлів робочої теки. Підсвітку обираємо за розширенням.
 */

const BY_EXTENSION = {
  js: javascript, jsx: () => javascript({ jsx: true }), mjs: javascript,
  ts: () => javascript({ typescript: true }),
  tsx: () => javascript({ typescript: true, jsx: true }),
  py: python,
  md: markdown, markdown: markdown,
  json,
  html, htm: html,
  css,
};

export function languageFor(filename) {
  const ext = String(filename || '').split('.').pop().toLowerCase();
  const factory = BY_EXTENSION[ext];
  return factory ? [factory()] : [];
}

export default function CodeEditor({ value, onChange, filename, readOnly = false, height = '60vh' }) {
  const extensions = useMemo(() => languageFor(filename), [filename]);
  return (
    <CodeMirror
      value={value}
      height={height}
      extensions={extensions}
      editable={!readOnly}
      onChange={onChange}
      basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: !readOnly }}
      theme="light"
    />
  );
}
