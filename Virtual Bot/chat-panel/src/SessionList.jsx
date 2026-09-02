import React, { useMemo, useState } from 'react';
import { Button, Input, Dropdown, Modal, message } from 'antd';
import {
  PlusOutlined,
  SearchOutlined,
  StarFilled,
  StarOutlined,
  FolderOutlined,
  FolderAddOutlined,
  MoreOutlined,
} from '@ant-design/icons';

/**
 * Сайдбар чатів: зверху завжди «Проєкти» (папка з власною бібліотекою),
 * нижче — пошук і плоский список розмов. Кожен чат можна перенести в
 * проєкт через кнопку-теку, яка з'являється при наведенні.
 */

function whenLabel(updated) {
  if (!updated) return '';
  const diff = Date.now() / 1000 - updated;
  if (diff < 60) return 'щойно';
  if (diff < 3600) return `${Math.floor(diff / 60)} хв тому`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} год тому`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} дн тому`;
  return new Date(updated * 1000).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });
}

export default function SessionList({
  sessions,
  activeId,
  onOpen,
  onNew,
  onPin,
  projects,
  onOpenProject,
  onCreateProject,
  onMoveToProject,
}) {
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => (s.title || '').toLowerCase().includes(q));
  }, [sessions, query]);

  const submitCreate = async () => {
    const name = nameDraft.trim();
    if (!name) return;
    try {
      const created = await onCreateProject(name);
      if (typeof creating === 'string' && creating.startsWith('for-chat:')) {
        onMoveToProject(creating.slice(9), created.id);
      }
      setCreating(false);
      setNameDraft('');
    } catch (e) {
      message.error(`Не вдалося створити проєкт: ${e.message}`);
    }
  };

  const projectMenu = (session) => ({
    items: [
      ...projects.map((p) => ({ key: `move:${p.id}`, icon: <FolderOutlined />, label: p.name })),
      projects.length > 0 ? { type: 'divider' } : null,
      { key: 'new', icon: <FolderAddOutlined />, label: 'Новий проєкт…' },
      session.project ? { key: 'unassign', label: 'Прибрати з проєкту' } : null,
    ].filter(Boolean),
    onClick: ({ key }) => {
      if (key === 'new') {
        setCreating('for-chat:' + session.id);
        setNameDraft('');
      } else if (key === 'unassign') {
        onMoveToProject(session.id, '');
      } else if (key.startsWith('move:')) {
        onMoveToProject(session.id, key.slice(5));
      }
    },
  });

  return (
    <div className="session-list">
      <div className="session-list-head">
        <Input
          size="small"
          allowClear
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          prefix={<SearchOutlined />}
          placeholder="Пошук у чатах"
        />
        <Button size="small" type="text" icon={<PlusOutlined />} onClick={onNew} title="Новий чат" />
      </div>

      {/* Проєкти — тека з власною бібліотекою і чатами, завжди зверху. */}
      <div className="project-section">
        <div className="project-section-head">
          <span>Проєкти</span>
          <button
            type="button"
            className="project-section-add"
            onClick={() => {
              setCreating(true);
              setNameDraft('');
            }}
            title="Новий проєкт"
          >
            <PlusOutlined />
          </button>
        </div>
        {projects.length > 0 && (
          <div className="project-section-items">
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                className="project-section-row"
                onClick={() => onOpenProject(p.id)}
              >
                <FolderOutlined /> <span>{p.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="session-list-items">
        {shown.map((s) => (
          <div
            key={s.id}
            className={`session-row${s.id === activeId ? ' session-row-active' : ''}`}
          >
            <button type="button" className="session-row-open" onClick={() => onOpen(s.id)}>
              <span className="session-row-title">{s.title || 'Без назви'}</span>
              <span className="session-row-when">
                {whenLabel(s.updated)}
                {s.project && (
                  <span className="session-row-project">
                    {' · '}
                    {projects.find((p) => p.id === s.project)?.name || s.project}
                  </span>
                )}
              </span>
            </button>
            <Dropdown menu={projectMenu(s)} trigger={['click']}>
              <button
                type="button"
                className="session-row-move"
                title="Перемістити в проєкт"
                aria-label="Перемістити в проєкт"
                onClick={(e) => e.preventDefault()}
              >
                <MoreOutlined />
              </button>
            </Dropdown>
            <button
              type="button"
              className={`session-row-pin${s.pinned ? ' session-row-pin-active' : ''}`}
              onClick={() => onPin(s.id, !s.pinned)}
              title={s.pinned ? 'Відкріпити чат' : 'Закріпити чат зверху'}
              aria-label={s.pinned ? 'Відкріпити чат' : 'Закріпити чат зверху'}
            >
              {s.pinned ? <StarFilled /> : <StarOutlined />}
            </button>
          </div>
        ))}
        {shown.length === 0 && (
          <div className="session-list-empty">
            {sessions.length ? 'нічого не знайшлось' : 'поки що жодного чату'}
          </div>
        )}
      </div>

      <Modal
        open={!!creating}
        title="Новий проєкт"
        okText="Створити"
        cancelText="Скасувати"
        onCancel={() => setCreating(false)}
        onOk={submitCreate}
      >
        <Input
          autoFocus
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onPressEnter={submitCreate}
          placeholder="Наприклад, «Сайт котиків»"
        />
      </Modal>
    </div>
  );
}
