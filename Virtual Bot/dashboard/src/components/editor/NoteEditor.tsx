import { useEffect } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';

/*
 * Редактор нотаток памʼяті.
 *
 * Tiptap v3 з офіційним markdown-розширенням — наш дефолт для текстових
 * редакторів (див. ~/stack/doc-editor.md). Важливо саме round-trip: бот читає
 * й пише ці ж файли як звичайний Markdown, тож редактор мусить віддавати
 * markdown, а не HTML. Стара панель стояла на Milkdown, що суперечило
 * власному каталогу рішень.
 */
export function NoteEditor({
  value,
  onChange,
  editable = true,
}: {
  value: string;
  onChange?: (markdown: string) => void;
  editable?: boolean;
}) {
  const editor = useEditor({
    extensions: [StarterKit, Markdown],
    content: value,
    editable,
    // Tiptap v3 у React 18+ монтується двічі в StrictMode; прапорець гасить
    // попередження про невідповідність гідратації.
    immediatelyRender: false,
    onUpdate: ({ editor: instance }) => {
      onChange?.(instance.getMarkdown());
    },
    editorProps: {
      attributes: {
        class:
          'prose-note min-h-full px-5 py-4 outline-none',
      },
    },
  });

  // Зовнішня заміна вмісту (відкрили іншу нотатку). Порівнюємо з поточним
  // markdown, щоб не збивати курсор на кожен власний апдейт.
  useEffect(() => {
    if (!editor) return;
    if (editor.getMarkdown() === value) return;
    editor.commands.setContent(value, { contentType: 'markdown' });
  }, [editor, value]);

  return <EditorContent editor={editor} className="size-full overflow-y-auto" />;
}
