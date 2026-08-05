import React, { useMemo, useState } from 'react';
import { Button, Input } from 'antd';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';

/**
 * Список збережених розмов: пошук + назва, яку придумав бот, + коли востаннє.
 * На широкому екрані живе збоку, на вузькому — у шухляді (див. App.jsx).
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

export default function SessionList({ sessions, activeId, onOpen, onNew }) {
  const [query, setQuery] = useState('');

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => (s.title || '').toLowerCase().includes(q));
  }, [sessions, query]);

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

      <div className="session-list-items">
        {shown.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`session-row${s.id === activeId ? ' session-row-active' : ''}`}
            onClick={() => onOpen(s.id)}
          >
            <span className="session-row-title">{s.title || 'Без назви'}</span>
            <span className="session-row-when">{whenLabel(s.updated)}</span>
          </button>
        ))}
        {shown.length === 0 && (
          <div className="session-list-empty">
            {sessions.length ? 'нічого не знайшлось' : 'поки що жодного чату'}
          </div>
        )}
      </div>
    </div>
  );
}
