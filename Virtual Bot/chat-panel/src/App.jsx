import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bubble, Sender } from '@ant-design/x';
import { ConfigProvider, theme, Button, Card } from 'antd';
import {
  PlusOutlined,
  CloudOutlined,
  DollarOutlined,
  BookOutlined,
  SearchOutlined,
  DownOutlined,
  UpOutlined,
} from '@ant-design/icons';
import { XMarkdown } from '@ant-design/x-markdown';

const api = async (path, options = {}) => {
  const res = await fetch(path, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.text();
};

const SESSION_KEY = 'virtual_bot_session_id';

const toolIcons = {
  weather: <CloudOutlined />,
  currency: <DollarOutlined />,
  facts: <BookOutlined />,
  web_search: <SearchOutlined />,
};

const toolTitles = {
  weather: 'Погода',
  currency: 'Курс валют',
  facts: 'Факт',
  web_search: 'Пошук в інтернеті',
};

const QUICK_ACTIONS = [
  { icon: '🌤', label: 'Погода', prompt: 'Яка погода у Києві?' },
  { icon: '💱', label: 'Курс', prompt: 'Курс USD до UAH' },
  { icon: '📖', label: 'Факт', prompt: 'Розкажи факт про ' },
  { icon: '🔍', label: 'Пошук', prompt: 'Знайди в інтернеті ' },
];

function looksLikeToolQuery(text) {
  const lowered = (text || '').toLowerCase();
  return (
    lowered.includes('погод') ||
    lowered.includes('weather') ||
    lowered.includes('температур') ||
    lowered.includes('курс') ||
    lowered.includes('валют') ||
    lowered.includes('долар') ||
    lowered.includes('євро') ||
    lowered.includes('usd') ||
    lowered.includes('eur') ||
    lowered.includes('uah') ||
    lowered.includes('факт') ||
    lowered.includes('хто такий') ||
    lowered.includes('що таке') ||
    lowered.includes('wikipedia') ||
    lowered.includes('знайди') ||
    lowered.includes('пошук') ||
    lowered.includes('search') ||
    lowered.includes('google') ||
    lowered.includes('інтернет') ||
    lowered.includes('новини')
  );
}

function ToolCard({ tool, input, result }) {
  const safeInput = input && typeof input === 'object' ? input : {};
  const safeResult = result && typeof result === 'object' ? result : {};
  const title = toolTitles[tool] || tool;
  const icon = toolIcons[tool] || null;
  const error = safeResult.error;
  const forecast = Array.isArray(safeResult.forecast) ? safeResult.forecast : [];
  const searchResults = Array.isArray(safeResult.results) ? safeResult.results : [];
  const rate = Number(safeResult.rate);
  const inverse = Number(safeResult.inverse);
  const [expanded, setExpanded] = useState(false);

  const cardTitle = (
    <span className="tool-card-title">
      {icon} {title}
      <span className="tool-card-expand">
        {expanded ? <UpOutlined /> : <DownOutlined />}
      </span>
    </span>
  );

  return (
    <Card
      size="small"
      className="tool-card"
      title={cardTitle}
      onClick={() => !error && setExpanded((v) => !v)}
      style={{
        marginTop: 12,
        borderRadius: 10,
        background: '#FDF8F2',
        border: '1px solid #E4E1D6',
        cursor: error ? 'default' : 'pointer',
      }}
    >
      {error ? (
        <div className="tool-card-error">{error}</div>
      ) : (
        <div className="tool-card-body" onClick={(e) => e.stopPropagation()}>
          {tool === 'weather' && (
            <>
              <div className="tool-card-city">{result.city}</div>
              <div className="tool-card-value">
                {safeResult.temperature}°C, {safeResult.condition}
                {safeResult.icon ? ` ${safeResult.icon}` : ''}
              </div>
              {safeResult.humidity !== undefined && (
                <div className="tool-card-meta">Вологість: {safeResult.humidity}%</div>
              )}
              {safeResult.wind_speed !== undefined && (
                <div className="tool-card-meta">Вітер: {safeResult.wind_speed} км/год</div>
              )}
              {expanded && forecast.length > 0 && (
                <div className="tool-card-forecast">
                  <div className="tool-card-section-title">Прогноз на 5 днів</div>
                  {forecast.map((day, index) => (
                    <div key={day?.day || index} className="tool-card-forecast-day">
                      <span>{day.day}</span>
                      <span>{day.icon} {day.min}°…{day.max}°</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {tool === 'currency' && (
            <>
              <div className="tool-card-pair">
                {safeInput.base || '?'} → {safeInput.target || '?'}
              </div>
              <div className="tool-card-value">{Number.isFinite(rate) ? rate.toFixed(4) : 'н/д'}</div>
              {Number.isFinite(inverse) && (
                <div className="tool-card-meta">зворотний: {inverse.toFixed(4)}</div>
              )}
              {safeResult.date && (
                <div className="tool-card-meta">на дату: {safeResult.date}</div>
              )}
            </>
          )}
          {tool === 'facts' && (
            <>
              <div className="tool-card-title-line">{safeResult.title}</div>
              <div className="tool-card-summary">{safeResult.summary}</div>
              {safeResult.url && (
                <a
                  className="tool-card-link"
                  href={safeResult.url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  Читати у Вікіпедії
                </a>
              )}
            </>
          )}
          {tool === 'web_search' && (
            <>
              <div className="tool-card-query">{safeResult.query}</div>
              {searchResults.map((r, index) => (
                <div key={r?.url || index} className="tool-card-result">
                  <a
                    className="tool-card-link"
                    href={r?.url || '#'}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {r?.title || 'Результат'}
                  </a>
                  <div className="tool-card-summary">{r?.snippet || ''}</div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </Card>
  );
}

function App() {
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState([]);
  const [messages, setMessages] = useState([]);
  const [sessionId, setSessionId] = useState(() => {
    try {
      return localStorage.getItem(SESSION_KEY) || '';
    } catch {
      return '';
    }
  });
  const abortRef = useRef(null);

  useEffect(() => {
    api('/api/models')
      .then((r) => {
        const list = (r.models || []).map((m) => ({
          value: m.id,
          label: m.label || m.id,
        }));
        setModels(list);
        if (r.selected) setSelectedModel(r.selected);
      })
      .catch(() => setModels([]));
  }, []);

  useEffect(() => {
    if (!selectedModel) return;
    fetch('/api/model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: selectedModel }),
    }).catch(() => {});
  }, [selectedModel]);

  const handleSubmit = async (value) => {
    const text = value.trim();
    if (!text && files.length === 0) return;

    const fileLinks = files
      .filter((f) => f.status === 'done' && f.url)
      .map((f) => `[${f.name}](${f.url})`)
      .join('\n');

    const userContent = [text, fileLinks].filter(Boolean).join('\n\n');

      setInput('');
      setFiles([]);
      setLoading(true);

      const botIndex = messages.length + 1;
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: userContent },
        { role: 'ai', content: '', streaming: true, toolResults: [], mode: '', toolSteps: [] },
      ]);

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: userContent, stream: true, session_id: sessionId }),
        });
        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`HTTP ${res.status}: ${errText}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullReply = '';
        let emotion = 'idle';
        let toolResults = [];
        let mode = '';
        let toolSteps = [];
        abortRef.current = { abort: () => reader.cancel() };

        while (true) {
          const { done, value: chunk } = await reader.read();
          if (done) break;
          buffer += decoder.decode(chunk, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();
          let eventType = null;
          for (const line of lines) {
            if (line.startsWith('event:')) {
              eventType = line.slice('event:'.length).trim();
            } else if (line.startsWith('data:')) {
              const dataLine = line.slice('data:'.length).trim();
              if (eventType && dataLine) {
                try {
                  const payload = JSON.parse(dataLine);
                  if (eventType === 'delta') {
                    fullReply += payload.chunk || '';
                    updateBotMessage(botIndex, fullReply, true, toolResults, mode, toolSteps);
                  } else if (eventType === 'emotion') {
                    emotion = payload.emotion || emotion;
                  } else if (eventType === 'tool_start') {
                    toolSteps = [
                      ...toolSteps,
                      {
                        type: 'start',
                        tool: payload.tool,
                        input: payload.input,
                        id: `${payload.tool}-${toolSteps.length}`,
                      },
                    ];
                    updateBotMessage(botIndex, fullReply, true, toolResults, mode, toolSteps);
                  } else if (eventType === 'tool_done') {
                    toolSteps = toolSteps.map((s) =>
                      s.tool === payload.tool && s.type === 'start'
                        ? { ...s, type: 'done', result: payload.result }
                        : s
                    );
                    updateBotMessage(botIndex, fullReply, true, toolResults, mode, toolSteps);
                  } else if (eventType === 'done') {
                    fullReply = payload.reply || fullReply;
                    emotion = payload.emotion || emotion;
                    toolResults = Array.isArray(payload.tool_results)
                      ? payload.tool_results.filter(
                          (tr) => tr && typeof tr === 'object' && typeof tr.tool === 'string' && tr.tool && tr.result && typeof tr.result === 'object'
                        )
                      : [];
                    mode = payload.mode || '';
                    if (payload.session_id && payload.session_id !== sessionId) {
                      setSessionId(payload.session_id);
                      try {
                        localStorage.setItem(SESSION_KEY, payload.session_id);
                      } catch {}
                    }
                    updateBotMessage(botIndex, fullReply, false, toolResults, mode, toolSteps);
                  } else if (eventType === 'error') {
                    throw new Error(payload.error || 'Streaming error');
                  }
                } catch (e) {
                  updateBotMessage(botIndex, `Помилка: ${e.message}`, false, toolResults, mode, toolSteps);
                }
                eventType = null;
              }
            }
          }
        }
        updateBotMessage(botIndex, fullReply || '(порожня відповідь)', false, toolResults, mode, toolSteps);
      } catch (err) {
        updateBotMessage(botIndex, `Помилка: ${err.message}`, false, [], mode, []);
      } finally {
        abortRef.current = null;
        setLoading(false);
      }
    };

  const updateBotMessage = (index, content, streaming, toolResults, mode, toolSteps) => {
    setMessages((prev) => {
      const next = [...prev];
      if (next[index]) {
        next[index] = {
          ...next[index],
          content,
          streaming,
          toolResults: toolResults || next[index].toolResults || [],
          mode: mode || next[index].mode || '',
          toolSteps: toolSteps || next[index].toolSteps || [],
        };
      }
      return next;
    });
  };


  const handleCancel = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      setLoading(false);
    }
  };

  const fileInputRef = useRef(null);

  const handleFileSelect = async (event) => {
    const selectedFiles = Array.from(event.target.files || []);
    if (selectedFiles.length === 0) return;

    for (const file of selectedFiles) {
      const uid = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const uploadingFile = {
        uid,
        name: file.name,
        status: 'uploading',
        url: '',
      };
      setFiles((prev) => [...prev, uploadingFile]);

      try {
        const formData = new FormData();
        formData.append('file', file);
        const r = await fetch('/api/chat/upload', {
          method: 'POST',
          body: formData,
        });
        if (!r.ok) throw new Error(`Upload failed: ${r.status}`);
        const data = await r.json();
        setFiles((prev) =>
          prev.map((f) =>
            f.uid === uid
              ? { ...f, status: 'done', url: data.url, name: data.name }
              : f
          )
        );
      } catch (e) {
        setFiles((prev) =>
          prev.map((f) =>
            f.uid === uid ? { ...f, status: 'error', error: e.message } : f
          )
        );
      }
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeFile = (uid) => {
    setFiles((prev) => prev.filter((f) => f.uid !== uid));
  };

  const items = useMemo(
    () =>
      messages.map((msg, index) => {
        const toolResults = msg.toolResults || [];
        return {
          key: index,
          role: msg.role,
          content: msg.content,
          streaming: msg.streaming,
          toolResults,
          toolSteps: msg.toolSteps || [],
          mode: msg.mode || '',
          contentRender:
            msg.role === 'ai'
              ? (content, info) => (
                  <div className="markdown-body">
                    <XMarkdown streaming={info?.streaming}>{content}</XMarkdown>
                    {toolResults.map((tr) => (
                      <ToolCard
                        key={`${tr.tool}-${JSON.stringify(tr.input || {})}`}
                        tool={tr.tool}
                        input={tr.input}
                        result={tr.result}
                      />
                    ))}
                  </div>
                )
              : undefined,
        };
      }),
    [messages]
  );

  const roles = {
    user: {
      placement: 'end',
      variant: 'filled',
      avatar: { icon: 'Ти', style: { background: '#5A5750', color: '#fff' } },
      style: {
        background: '#F5E6D3',
        color: '#2B2A26',
        border: '1px solid #EAD5BC',
      },
      contentRender: (content) => (
        <div className="user-content" style={{ whiteSpace: 'pre-wrap' }}>
          {content}
        </div>
      ),
    },
    ai: {
      placement: 'start',
      variant: 'filled',
      avatar: { icon: '🦀', style: { background: '#C96442', color: '#fff' } },
      style: {
        background: '#FFFFFF',
        color: '#2B2A26',
        border: '1px solid #E4E1D6',
      },
      loadingRender: (props) => {
        const item = items[props.index] || items.find((candidate) => candidate.streaming) || {};
        const steps = item.toolSteps || [];
        const lastUserMsg = messages.slice().reverse().find((m) => m.role === 'user');
        const toolInProgress =
          steps.length > 0 ||
          (loading && lastUserMsg && looksLikeToolQuery(lastUserMsg.content));
        return (
          <div className="chat-loading">
            {toolInProgress ? (
              <div>
                <div>🔧 використовую інструменти…</div>
                {steps.length > 0 && (
                  <ul className="tool-steps">
                    {steps.map((s) => {
                      const toolName = toolTitles[s.tool] || s.tool;
                      if (s.type === 'start') {
                        return (
                          <li key={s.id} className="tool-step tool-step-running">
                            ⏳ {toolName}: викликаю…
                          </li>
                        );
                      }
                      if (s.type === 'done') {
                        const hasError = s.result?.error;
                        return (
                          <li
                            key={s.id}
                            className={`tool-step ${hasError ? 'tool-step-error' : 'tool-step-done'}`}
                          >
                            {hasError ? '⚠️' : '✅'} {toolName}: {hasError ? s.result.error : 'готово'}
                          </li>
                        );
                      }
                      return null;
                    })}
                  </ul>
                )}
              </div>
            ) : (
              'бот думає…'
            )}
          </div>
        );
      },
      contentRender: (content, info) => (
        <div className="markdown-body">
          <XMarkdown streaming={info?.streaming}>{content}</XMarkdown>
        </div>
      ),
    },
  };

  return (
    <div className="chat-panel">
      <div className="chat-panel-header">
        <span className="chat-panel-title">💬 Чат із Клодом Ботом</span>
        <label className="chat-panel-model">
          <span>Модель:</span>
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            disabled={models.length === 0}
          >
            {models.length === 0 && <option value="">— недоступно —</option>}
            {models.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="chat-messages">
        <Bubble.List items={items} roles={roles} autoScroll />
      </div>

      <div className="chat-input-area">
        {files.length > 0 && (
          <div className="attached-files">
            {files.map((f) => (
              <div key={f.uid} className={`attached-file ${f.status}`}>
                <span className="attached-file-name">{f.name}</span>
                {f.status === 'uploading' && (
                  <span className="attached-file-status">завантаження…</span>
                )}
                {f.status === 'error' && (
                  <span className="attached-file-status">помилка</span>
                )}
                {f.status === 'done' && (
                  <button type="button" className="attached-file-remove" onClick={() => removeFile(f.uid)}>
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        <input
          type="file"
          ref={fileInputRef}
          style={{ display: 'none' }}
          onChange={handleFileSelect}
          multiple
        />

        <div className="quick-actions">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.label}
              type="button"
              className="quick-action-chip"
              onClick={() => setInput(action.prompt)}
              title={action.prompt}
              disabled={loading}
            >
              <span className="quick-action-icon">{action.icon}</span>
              <span>{action.label}</span>
            </button>
          ))}
        </div>

        <Sender
          value={input}
          onChange={(v) => setInput(v)}
          onSubmit={handleSubmit}
          loading={loading}
          placeholder="Повідомлення для бота…"
          allowSpeech={false}
          prefix={
            <Button
              type="text"
              icon={<PlusOutlined />}
              onClick={() => fileInputRef.current?.click()}
              title="Прикріпити файл"
            />
          }
        />
      </div>
    </div>
  );
}

export default function WrappedApp() {
  return (
    <ConfigProvider
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: '#C96442',
          colorBgContainer: '#FBFAF7',
          colorBorder: '#E4E1D6',
          colorText: '#2B2A26',
          colorTextSecondary: '#83817A',
          borderRadius: 10,
        },
      }}
    >
      <App />
    </ConfigProvider>
  );
}
