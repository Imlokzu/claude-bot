import React, { useCallback, useEffect, useState } from 'react';
import { ConfigProvider, theme, Button, Modal, Input, message } from 'antd';
import {
  FolderOutlined,
  FolderOpenOutlined,
  FileTextOutlined,
  ReloadOutlined,
  SaveOutlined,
  DeleteOutlined,
  FolderAddOutlined,
  FileAddOutlined,
} from '@ant-design/icons';
import CodeEditor from './CodeEditor.jsx';

/**
 * Вкладка «Файли» — робоча тека бота на диску (workspace/).
 *
 * Дерево вантажиться лінькувато (по кліку на теку — окремий запит), бо
 * рекурсивний обхід великої теки на кожен рендер клав би панель. Редактор —
 * той самий CodeMirror, що й для вставок у чаті.
 */

const SESSION_KEY = 'virtual_bot_session_id';

const sessionId = () => {
  try {
    return localStorage.getItem(SESSION_KEY) || '';
  } catch {
    return '';
  }
};

const api = async (path, options) => {
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
  return data;
};

const withSession = (path) => {
  const sid = sessionId();
  return sid ? `${path}${path.includes('?') ? '&' : '?'}session_id=${encodeURIComponent(sid)}` : path;
};

function TreeNode({ entry, depth, onOpenFile, selectedPath }) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api(withSession(`/api/workspace/list?path=${encodeURIComponent(entry.path)}`));
      setChildren(data.entries || []);
    } catch (e) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [entry.path]);

  const toggle = async () => {
    if (entry.type === 'file') {
      onOpenFile(entry);
      return;
    }
    const next = !open;
    setOpen(next);
    if (next && children === null) await load();
  };

  const isSelected = selectedPath === entry.path;

  return (
    <div className="ws-node">
      <button
        type="button"
        className={`ws-row${isSelected ? ' ws-row-selected' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={toggle}
      >
        <span className="ws-row-icon">
          {entry.type === 'dir' ? (open ? <FolderOpenOutlined /> : <FolderOutlined />) : <FileTextOutlined />}
        </span>
        <span className="ws-row-name">{entry.name}</span>
        {entry.type === 'file' && <span className="ws-row-size">{Math.ceil(entry.size / 102.4) / 10} КБ</span>}
      </button>
      {open && (
        <div className="ws-children">
          {loading && <div className="ws-hint" style={{ paddingLeft: 22 + depth * 14 }}>завантаження…</div>}
          {(children || []).map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              onOpenFile={onOpenFile}
              selectedPath={selectedPath}
            />
          ))}
          {children && children.length === 0 && (
            <div className="ws-hint" style={{ paddingLeft: 22 + depth * 14 }}>порожньо</div>
          )}
        </div>
      )}
    </div>
  );
}

function Workspace() {
  const [info, setInfo] = useState(null);
  const [rootEntries, setRootEntries] = useState([]);
  const [file, setFile] = useState(null); // {path, content, dirty}
  const [saving, setSaving] = useState(false);
  const [createKind, setCreateKind] = useState(null); // 'file' | 'dir'
  const [createName, setCreateName] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [meta, list] = await Promise.all([
        api(withSession('/api/workspace/info')),
        api(withSession('/api/workspace/list?path=')),
      ]);
      setInfo(meta);
      setRootEntries(list.entries || []);
    } catch (e) {
      message.error(e.message);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const openFile = async (entry) => {
    try {
      const data = await api(withSession(`/api/workspace/file?path=${encodeURIComponent(entry.path)}`));
      if (data.binary) {
        message.info('Це бінарний файл — редактор його не показує');
        return;
      }
      if (data.too_large) {
        message.info('Файл завеликий для редактора');
        return;
      }
      setFile({ path: data.path, content: data.content, dirty: false });
    } catch (e) {
      message.error(e.message);
    }
  };

  const save = async () => {
    if (!file) return;
    setSaving(true);
    try {
      await api('/api/workspace/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: file.path, content: file.content, session_id: sessionId() }),
      });
      setFile((prev) => (prev ? { ...prev, dirty: false } : prev));
      message.success('Збережено');
    } catch (e) {
      message.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const removeCurrent = async () => {
    if (!file) return;
    Modal.confirm({
      title: 'Прибрати файл?',
      content: `${file.path} переїде в .trash — назавжди нічого не стирається.`,
      okText: 'Прибрати',
      cancelText: 'Скасувати',
      onOk: async () => {
        await api('/api/workspace/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: file.path, session_id: sessionId() }),
        });
        setFile(null);
        refresh();
      },
    });
  };

  const create = async () => {
    const name = createName.trim();
    if (!name) return;
    try {
      if (createKind === 'dir') {
        await api('/api/workspace/mkdir', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: name, session_id: sessionId() }),
        });
      } else {
        await api('/api/workspace/file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: name, content: '', session_id: sessionId() }),
        });
        setFile({ path: name, content: '', dirty: false });
      }
      setCreateKind(null);
      setCreateName('');
      refresh();
    } catch (e) {
      message.error(e.message);
    }
  };

  return (
    <div className="ws-panel">
      <div className="ws-header">
        <div>
          <div className="ws-title">
            <FolderOpenOutlined /> Робоча тека бота
          </div>
          <div className="ws-path" title={info?.root || ''}>
            {info?.root || '—'}
          </div>
        </div>
        <div className="ws-actions">
          <Button size="small" icon={<FileAddOutlined />} onClick={() => setCreateKind('file')}>
            Файл
          </Button>
          <Button size="small" icon={<FolderAddOutlined />} onClick={() => setCreateKind('dir')}>
            Тека
          </Button>
          <Button size="small" icon={<ReloadOutlined />} onClick={refresh}>
            Оновити
          </Button>
        </div>
      </div>

      <div className="ws-body">
        <div className="ws-tree">
          {rootEntries.map((entry) => (
            <TreeNode
              key={entry.path}
              entry={entry}
              depth={0}
              onOpenFile={openFile}
              selectedPath={file?.path}
            />
          ))}
          {rootEntries.length === 0 && <div className="ws-hint">тека порожня</div>}
          {info?.session_path && (
            <div className="ws-session-hint">
              тека цієї розмови: <code>{info.session_path}</code>
            </div>
          )}
        </div>

        <div className="ws-editor">
          {file ? (
            <>
              <div className="ws-editor-bar">
                <span className="ws-editor-path">
                  {file.path}
                  {file.dirty ? ' •' : ''}
                </span>
                <span className="ws-editor-buttons">
                  <Button
                    size="small"
                    type="primary"
                    icon={<SaveOutlined />}
                    loading={saving}
                    disabled={!file.dirty}
                    onClick={save}
                  >
                    Зберегти
                  </Button>
                  <Button size="small" danger icon={<DeleteOutlined />} onClick={removeCurrent} />
                </span>
              </div>
              <CodeEditor
                value={file.content}
                filename={file.path}
                height="calc(100vh - 320px)"
                onChange={(val) => setFile((prev) => ({ ...prev, content: val, dirty: true }))}
              />
            </>
          ) : (
            <div className="ws-empty">Обери файл ліворуч — відкриється в редакторі</div>
          )}
        </div>
      </div>

      <Modal
        open={!!createKind}
        title={createKind === 'dir' ? 'Нова тека' : 'Новий файл'}
        okText="Створити"
        cancelText="Скасувати"
        onCancel={() => setCreateKind(null)}
        onOk={create}
      >
        <Input
          autoFocus
          value={createName}
          onChange={(e) => setCreateName(e.target.value)}
          onPressEnter={create}
          placeholder={createKind === 'dir' ? 'projects/нова-тека' : 'notes/ідея.md'}
        />
      </Modal>
    </div>
  );
}

export default function WrappedWorkspace() {
  return (
    <ConfigProvider
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: '#C96442',
          /* Шрифт задаємо токеном antd: його власний reset інакше перебиває
             body-стиль сторінки, і панель лишалась на дефолтному ui-sans-serif. */
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, ui-sans-serif, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',

          colorBgContainer: '#FBFAF7',
          colorBorder: '#E4E1D6',
          colorText: '#2B2A26',
          borderRadius: 10,
        },
      }}
    >
      <Workspace />
    </ConfigProvider>
  );
}
