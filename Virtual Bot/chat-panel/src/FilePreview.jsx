import React, { useEffect, useState } from 'react';
import { Button, Tooltip } from 'antd';
import { ExportOutlined, ReloadOutlined, CodeOutlined, EyeOutlined, ExpandOutlined } from '@ant-design/icons';
import { XMarkdown } from '@ant-design/x-markdown';

/**
 * Міні-прев'ю файлу, який щойно написав бот — прямо в чаті.
 *
 * Було так: бот мовчки щось робив і аж потім казав «готово, відкрий у
 * Finder». Тепер видно і сам код, і — якщо це сторінка — як вона виглядає,
 * без виходу з чату.
 */

const SESSION_KEY = 'virtual_bot_session_id';

const sessionId = () => {
  try {
    return localStorage.getItem(SESSION_KEY) || '';
  } catch {
    return '';
  }
};

const previewUrl = (path) =>
  `/preview/${path.split('/').map(encodeURIComponent).join('/')}?session_id=${encodeURIComponent(sessionId())}`;

export default function FilePreview({ path, live, big, onExpand }) {
  const isPage = /\.html?$/i.test(path || '');
  const isMarkdown = /\.(md|markdown)$/i.test(path || '');
  const isImage = /\.(png|jpe?g|gif|webp|svg)$/i.test(path || '');
  const canRender = isPage || isMarkdown || isImage;
  const [mode, setMode] = useState(canRender ? 'page' : 'code');
  const [code, setCode] = useState('');
  const [nonce, setNonce] = useState(0);

  /* Поки бот пише, перечитуємо файл — так видно, як він росте рядок за
     рядком, а не тільки готовий результат. */
  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const url = `/api/workspace/file?path=${encodeURIComponent(path)}&session_id=${encodeURIComponent(sessionId())}`;
        const data = await fetch(url).then((r) => r.json());
        if (!stop && typeof data.content === 'string') setCode(data.content);
      } catch {
        /* файл ще не створено — просто чекаємо наступного тіку */
      }
    };
    load();
    if (!live) return () => { stop = true; };
    const timer = setInterval(load, 1200);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [path, live]);

  const lines = code ? code.split('\n') : [];
  const shown = lines.slice(-14); // хвіст: цікаво саме те, що дописується

  return (
    <div className={`file-preview${big ? ' file-preview-big' : ''}`}>
      <div className="file-preview-head">
        <span className="file-preview-path">{path}</span>
        <span className="file-preview-actions">
          {canRender && (
            <Tooltip title={mode === 'page' ? 'Показати код' : 'Показати як є'}>
              <Button
                size="small"
                type="text"
                icon={mode === 'page' ? <CodeOutlined /> : <EyeOutlined />}
                onClick={() => setMode((m) => (m === 'page' ? 'code' : 'page'))}
              />
            </Tooltip>
          )}
          {canRender && (
            <Tooltip title="Оновити">
              <Button size="small" type="text" icon={<ReloadOutlined />} onClick={() => setNonce((n) => n + 1)} />
            </Tooltip>
          )}
          {onExpand && (
            <Tooltip title="Розгорнути збоку">
              <Button size="small" type="text" icon={<ExpandOutlined />} onClick={() => onExpand(path)} />
            </Tooltip>
          )}
          <Tooltip title="Відкрити в новій вкладці">
            <Button
              size="small"
              type="text"
              icon={<ExportOutlined />}
              href={previewUrl(path)}
              target="_blank"
            />
          </Tooltip>
        </span>
      </div>

      {mode === 'page' && isImage ? (
        <div className="file-preview-image">
          <img src={previewUrl(path)} alt={path} />
        </div>
      ) : mode === 'page' && isMarkdown ? (
        <div className="file-preview-md markdown-body">
          <XMarkdown>{code}</XMarkdown>
        </div>
      ) : mode === 'page' ? (
        <iframe
          key={`${path}-${nonce}-${live ? lines.length : 'done'}`}
          className="file-preview-frame"
          title={path}
          src={previewUrl(path)}
          sandbox="allow-scripts allow-forms"
        />
      ) : (
        <pre className="file-preview-code">
          {shown.length ? shown.join('\n') : 'файл ще порожній…'}
          {live && <span className="file-preview-caret">▋</span>}
        </pre>
      )}
    </div>
  );
}
