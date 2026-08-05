import React, { useCallback, useEffect, useRef } from 'react';
import { Button, Tooltip } from 'antd';
import {
  CloseOutlined,
  ExportOutlined,
  ArrowLeftOutlined,
  FullscreenOutlined,
  FullscreenExitOutlined,
} from '@ant-design/icons';
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

export default function SidePreview({ path, width, onWidth, fullscreen, onToggleFullscreen, onClose }) {
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
    <aside
      className={`side-preview${fullscreen ? ' side-preview-fullscreen' : ''}`}
      style={fullscreen ? undefined : { width }}
      role={fullscreen ? 'dialog' : undefined}
      aria-modal={fullscreen ? 'true' : undefined}
      aria-label={fullscreen ? `Повноекранний перегляд: ${path}` : undefined}
    >
      <div className="side-preview-head">
        {/* У фулскрін-режимі зверху зʼявляється кнопка повернення до чату */}
        {fullscreen && (
          <Tooltip title="Назад до чату">
            <Button
              size="small"
              type="text"
              icon={<ArrowLeftOutlined />}
              onClick={onClose}
              aria-label="Назад до чату"
            />
          </Tooltip>
        )}
        <span className="side-preview-path" title={path}>
          {path}
        </span>
        <span className="side-preview-actions">
          {onToggleFullscreen && (
            <Tooltip title={fullscreen ? 'Згорнути збоку' : 'На весь екран'}>
              <Button
                size="small"
                type="text"
                icon={fullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
                onClick={onToggleFullscreen}
                aria-label={fullscreen ? 'Вийти з повноекранного перегляду' : 'Відкрити на весь екран'}
              />
            </Tooltip>
          )}
          <Tooltip title="Відкрити в новій вкладці">
            <Button
              size="small"
              type="text"
              icon={<ExportOutlined />}
              href={`/preview/${path.split('/').map(encodeURIComponent).join('/')}`}
              target="_blank"
              rel="noreferrer"
              aria-label="Відкрити в новій вкладці"
            />
          </Tooltip>
          <Button
            size="small"
            type="text"
            icon={<CloseOutlined />}
            onClick={onClose}
            aria-label="Закрити перегляд"
          />
        </span>
      </div>

      <div className="side-preview-body">
        <FilePreview path={path} big />
      </div>

      {/* Смужка для перетягування ширини — лише у боковому режимі */}
      {!fullscreen && (
        <div
          className="side-preview-grip"
          role="separator"
          aria-label="Змінити ширину перегляду"
          aria-orientation="vertical"
          aria-valuemin={MIN_WIDTH}
          aria-valuemax={Math.round(Math.min(MAX_WIDTH, window.innerWidth * 0.46))}
          aria-valuenow={Math.round(width)}
          tabIndex={0}
          onMouseDown={() => {
            dragging.current = true;
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
          }}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            const direction = event.key === 'ArrowLeft' ? -1 : 1;
            const limit = Math.min(MAX_WIDTH, window.innerWidth * 0.46);
            onWidth(Math.min(limit, Math.max(MIN_WIDTH, width + direction * 24)));
          }}
        />
      )}
    </aside>
  );
}
