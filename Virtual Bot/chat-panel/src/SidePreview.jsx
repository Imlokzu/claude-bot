import React, { useCallback, useEffect, useRef } from 'react';
import { Button, Tooltip } from 'antd';
import { CloseOutlined, ExportOutlined } from '@ant-design/icons';
import FilePreview from './FilePreview.jsx';

/**
 * Велике прев'ю збоку: сайт, картинка чи нотатка на пів-екрана.
 *
 * Сюди файл кладе або сам бот (тул workspace_show — раніше він міг лише
 * продиктувати команду `open …`), або кнопка «розгорнути» на міні-прев'ю в
 * відповіді. Ширину можна тягнути мишею — від вузької смужки до половини
 * вікна, бо сайт і нотатка вимагають різного місця.
 */

const MIN_WIDTH = 280;
const MAX_WIDTH = 900;

export default function SidePreview({ path, width, onWidth, onClose }) {
  const dragging = useRef(false);

  const onMove = useCallback(
    (event) => {
      if (!dragging.current) return;
      // Панель ліворуч від чату: ширина = позиція курсора від лівого краю
      /* Ширину ще й обмежуємо половиною вікна: інакше можна затягнути так,
         що від чату лишиться смужка. */
      const limit = Math.min(MAX_WIDTH, window.innerWidth * 0.46);
      const next = Math.min(limit, Math.max(MIN_WIDTH, event.clientX));
      onWidth(next);
    },
    [onWidth]
  );

  useEffect(() => {
    const stop = () => {
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', stop);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', stop);
      stop();
    };
  }, [onMove]);

  return (
    <aside className="side-preview" style={{ width }}>
      <div className="side-preview-head">
        <span className="side-preview-path" title={path}>
          {path}
        </span>
        <span className="side-preview-actions">
          <Tooltip title="Відкрити в новій вкладці">
            <Button
              size="small"
              type="text"
              icon={<ExportOutlined />}
              href={`/preview/${path.split('/').map(encodeURIComponent).join('/')}`}
              target="_blank"
            />
          </Tooltip>
          <Button size="small" type="text" icon={<CloseOutlined />} onClick={onClose} />
        </span>
      </div>

      <div className="side-preview-body">
        <FilePreview path={path} big />
      </div>

      {/* Смужка для перетягування ширини */}
      <div
        className="side-preview-grip"
        onMouseDown={() => {
          dragging.current = true;
          document.body.style.cursor = 'col-resize';
          document.body.style.userSelect = 'none';
        }}
      />
    </aside>
  );
}
