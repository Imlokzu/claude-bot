import React, { useEffect, useRef, useState } from 'react';
import { Button, message, Modal } from 'antd';
import { CopyOutlined, EditOutlined } from '@ant-design/icons';
import CodeEditor from './CodeEditor.jsx';

/**
 * Кнопки «копіювати» й «редагувати» на кожному блоці коду у відповіді.
 *
 * Markdown рендерить XMarkdown, тому власних React-вузлів у <pre> немає —
 * навішуємося на вже готовий DOM: знаходимо блоки коду в контейнері й
 * додаємо панельку. Редагування відкриває той самий CodeMirror, а звідти
 * можна скопіювати вже виправлену команду.
 */
export default function CodeActions({ containerRef, deps = [] }) {
  const [editing, setEditing] = useState(null); // {code}
  const cleanupRef = useRef([]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return undefined;

    /* XMarkdown домальовує розмітку ПІСЛЯ нашого ефекту (а під час стріму —
       ще й багато разів), тож одноразового проходу мало: слухаємо зміни DOM
       і навішуємо панельку на кожен новий блок коду. */
    const decorate = () => {
      root.querySelectorAll('pre').forEach((pre) => {
        if (pre.dataset.actionsReady === '1') return;
        pre.dataset.actionsReady = '1';

        const bar = document.createElement('div');
        bar.className = 'code-actions';

        const copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'code-action';
        copy.textContent = 'копіювати';
        copy.onclick = async (e) => {
          e.stopPropagation();
          await navigator.clipboard.writeText(codeOf(pre));
          message.success('Скопійовано');
        };

        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'code-action';
        edit.textContent = 'редагувати';
        edit.onclick = (e) => {
          e.stopPropagation();
          setEditing({ code: codeOf(pre) });
        };

        bar.append(copy, edit);
        pre.appendChild(bar);
        cleanupRef.current.push(() => bar.remove());
      });
    };

    const codeOf = (pre) => {
      const clone = pre.cloneNode(true);
      clone.querySelectorAll('.code-actions').forEach((el) => el.remove());
      return clone.innerText.trim();
    };

    decorate();
    const observer = new MutationObserver(decorate);
    observer.observe(root, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      cleanupRef.current.forEach((fn) => fn());
      cleanupRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return (
    <Modal
      open={!!editing}
      title="Правка перед копіюванням"
      onCancel={() => setEditing(null)}
      width="min(860px, 92vw)"
      footer={[
        <Button key="close" onClick={() => setEditing(null)}>
          Закрити
        </Button>,
        <Button
          key="copy"
          type="primary"
          icon={<CopyOutlined />}
          onClick={async () => {
            await navigator.clipboard.writeText(editing.code);
            message.success('Скопійовано');
            setEditing(null);
          }}
        >
          Копіювати
        </Button>,
      ]}
    >
      {editing && (
        <CodeEditor
          value={editing.code}
          filename="snippet.sh"
          height="50vh"
          onChange={(val) => setEditing((prev) => ({ ...prev, code: val }))}
        />
      )}
    </Modal>
  );
}

export { EditOutlined };
