import React, { useEffect, useState } from 'react';
import { Modal, Input, Button, message } from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  CheckOutlined,
  CloseOutlined,
  FolderOutlined,
  FileTextOutlined,
  LeftOutlined,
  MessageOutlined,
} from '@ant-design/icons';

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico']);

function extOf(name) {
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i).toLowerCase();
}

/**
 * «Проєкт»: тека завжди зверху списку чатів, зі своєю бібліотекою (усе, що
 * бот зберіг чи зробив у projects/<slug>/) і списком чатів, привʼязаних до
 * неї. Відкривається як модалка — не ламає основний layout чату.
 */
export default function ProjectModal({
  open,
  project,
  sessions,
  onClose,
  onOpenChat,
  onNewChatInProject,
  onExpand,
  onRenamed,
  onDeleted,
}) {
  const [path, setPath] = useState('');
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  const rootPath = project ? `projects/${project.id}` : '';

  useEffect(() => {
    if (open && project) setPath(rootPath);
  }, [open, project?.id]);

  useEffect(() => {
    if (!open || !path) return;
    setLoading(true);
    fetch(`/api/workspace/list?path=${encodeURIComponent(path)}`)
      .then((r) => r.json())
      .then((data) => setEntries(data.entries || []))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [open, path]);

  if (!project) return null;

  const chats = (sessions || []).filter((s) => s.project === project.id);
  const dirs = entries.filter((e) => e.type === 'dir');
  const images = entries.filter((e) => e.type === 'file' && IMAGE_EXT.has(extOf(e.name)));
  const files = entries.filter((e) => e.type === 'file' && !IMAGE_EXT.has(extOf(e.name)));
  // Крихти — лише те, що ЗАГЛИБЛЕНО від кореня проєкту; в самому корені їх нема.
  const relToRoot = path === rootPath ? '' : path.slice(rootPath.length + 1);
  const crumbs = relToRoot ? relToRoot.split('/').filter(Boolean) : [];

  const goCrumb = (i) => {
    setPath(`${rootPath}/${crumbs.slice(0, i + 1).join('/')}`);
  };

  const openFile = (entryPath) => {
    onExpand(entryPath);
    onClose();
  };

  const startRename = () => {
    setNameDraft(project.name);
    setRenaming(true);
  };

  const saveRename = async () => {
    const name = nameDraft.trim();
    if (!name || name === project.name) {
      setRenaming(false);
      return;
    }
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(project.id)}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'не вдалося');
      onRenamed(data);
      setRenaming(false);
    } catch (e) {
      message.error(`Не вдалося перейменувати: ${e.message}`);
    }
  };

  const removeProject = () => {
    Modal.confirm({
      title: `Видалити проєкт «${project.name}»?`,
      content: 'Файли переїдуть у .trash — назавжди нічого не стирається. Чати лишаться, просто відвʼяжуться від проєкту.',
      okText: 'Видалити',
      okButtonProps: { danger: true },
      cancelText: 'Скасувати',
      onOk: async () => {
        try {
          const res = await fetch(`/api/projects/${encodeURIComponent(project.id)}`, { method: 'DELETE' });
          if (!res.ok) throw new Error((await res.json()).detail || 'не вдалося');
          onDeleted(project.id);
          onClose();
        } catch (e) {
          message.error(`Не вдалося видалити: ${e.message}`);
        }
      },
    });
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width="min(720px, 94vw)"
      title={
        renaming ? (
          <div className="project-modal-rename">
            <Input
              autoFocus
              size="small"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onPressEnter={saveRename}
            />
            <Button size="small" type="text" icon={<CheckOutlined />} onClick={saveRename} />
            <Button size="small" type="text" icon={<CloseOutlined />} onClick={() => setRenaming(false)} />
          </div>
        ) : (
          <div className="project-modal-title">
            <FolderOutlined /> {project.name}
            <Button size="small" type="text" icon={<EditOutlined />} onClick={startRename} title="Перейменувати" />
            <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={removeProject} title="Видалити проєкт" />
          </div>
        )
      }
    >
      <div className="project-modal-section">
        <div className="project-modal-section-head">
          <span>Чати проєкту</span>
          <Button
            size="small"
            icon={<PlusOutlined />}
            onClick={() => {
              onNewChatInProject(project.id);
              onClose();
            }}
          >
            Новий чат тут
          </Button>
        </div>
        <div className="project-modal-chats">
          {chats.length === 0 && <div className="project-modal-empty">поки без чатів</div>}
          {chats.map((s) => (
            <button
              key={s.id}
              type="button"
              className="project-modal-chat-row"
              onClick={() => {
                onOpenChat(s.id);
                onClose();
              }}
            >
              <MessageOutlined /> <span>{s.title || 'Без назви'}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="project-modal-section">
        <div className="project-modal-section-head">
          <span>Бібліотека</span>
          {crumbs.length > 0 && (
            <div className="project-modal-crumbs">
              <button type="button" onClick={() => setPath(rootPath)} title="До кореня проєкту">
                {project.name}
              </button>
              {crumbs.map((c, i) => (
                <React.Fragment key={i}>
                  <span>/</span>
                  <button type="button" onClick={() => goCrumb(i)}>{c}</button>
                </React.Fragment>
              ))}
            </div>
          )}
        </div>

        {loading ? (
          <div className="project-modal-empty">завантаження…</div>
        ) : entries.length === 0 ? (
          <div className="project-modal-empty">тут ще порожньо — файли зʼявляться, коли бот попрацює над проєктом</div>
        ) : (
          <>
            {images.length > 0 && (
              <div className="project-modal-image-grid">
                {images.map((im) => (
                  <button
                    key={im.path}
                    type="button"
                    className="project-modal-image"
                    onClick={() => openFile(im.path)}
                    title={im.name}
                  >
                    <img src={`/preview/${im.path}`} alt={im.name} loading="lazy" />
                  </button>
                ))}
              </div>
            )}
            {(dirs.length > 0 || files.length > 0) && (
              <div className="project-modal-file-list">
                {path !== rootPath && (
                  <button
                    type="button"
                    className="project-modal-file-row"
                    onClick={() => setPath(path.split('/').slice(0, -1).join('/') || rootPath)}
                  >
                    <LeftOutlined /> <span>назад</span>
                  </button>
                )}
                {dirs.map((d) => (
                  <button key={d.path} type="button" className="project-modal-file-row" onClick={() => setPath(d.path)}>
                    <FolderOutlined /> <span>{d.name}</span>
                  </button>
                ))}
                {files.map((f) => (
                  <button key={f.path} type="button" className="project-modal-file-row" onClick={() => openFile(f.path)}>
                    <FileTextOutlined /> <span>{f.name}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
