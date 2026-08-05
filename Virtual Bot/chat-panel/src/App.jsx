import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bubble, Sender } from '@ant-design/x';
import { ConfigProvider, theme, Button, Card, Modal, Drawer, Tooltip, message } from 'antd';
import {
  PlusOutlined,
  CloudOutlined,
  DollarOutlined,
  BookOutlined,
  SearchOutlined,
  DownOutlined,
  UpOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  ToolOutlined,
  MenuOutlined,
  PictureOutlined,
} from '@ant-design/icons';
import { XMarkdown } from '@ant-design/x-markdown';
import BlurTypingInput from './BlurTypingInput.jsx';
import CodeEditor from './CodeEditor.jsx';
import MicButton from './MicButton.jsx';
import SessionList from './SessionList.jsx';

/* Хвиля — символ розмови голосом (кнопка біля мікрофона) */
function VoiceWave() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M4 11v2M8 8v8M12 5v14M16 8v8M20 11v2" />
    </svg>
  );
}

/* Знак у стилі Клода — восьмипроменева зірка. Використовуємо там, де раніше
   були емодзі (заголовок чату, аватар бота): вона масштабується, фарбується
   від currentColor і не залежить від емодзі-шрифту системи. */
function ClaudeMark({ size = 16, className = '' }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 2.2c.35 0 .64.27.67.62l.42 4.6 3.1-3.42a.67.67 0 0 1 1.13.66l-1.4 4.4 4.2-1.98a.67.67 0 0 1 .8 1.03l-2.94 3.56 4.6.42a.67.67 0 0 1 0 1.34l-4.6.42 2.93 3.56a.67.67 0 0 1-.79 1.03l-4.2-1.98 1.4 4.4a.67.67 0 0 1-1.13.66l-3.1-3.42-.42 4.6a.67.67 0 0 1-1.34 0l-.42-4.6-3.1 3.42a.67.67 0 0 1-1.13-.66l1.4-4.4-4.2 1.98a.67.67 0 0 1-.8-1.03l2.94-3.56-4.6-.42a.67.67 0 0 1 0-1.34l4.6-.42-2.94-3.56a.67.67 0 0 1 .8-1.03l4.2 1.98-1.4-4.4a.67.67 0 0 1 1.13-.66l3.1 3.42.42-4.6c.03-.35.32-.62.67-.62z"
      />
    </svg>
  );
}

/* Налаштування появи тексту під час стрімінгу відповіді бота:
   кожен новий фрагмент проявляється з блюру (див. .x-markdown span у styles.css),
   плюс миготливий «хвіст» ▋ на місці курсора, поки чанки ще йдуть. */
const STREAM_ANIMATION = {
  enableAnimation: true,
  animationConfig: { fadeDuration: 320, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)' },
  tail: true,
};

/* Той самий ефект, але для вже завершеної відповіді: анімації немає,
   інакше готовий текст «блимав» би при кожному ре-рендері. */
const STREAM_DONE = { hasNextChunk: false };

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
  image_search: <PictureOutlined />,
  workspace_list: <FolderOpenOutlined />,
  workspace_read: <FileTextOutlined />,
  workspace_write: <FileTextOutlined />,
  workspace_mkdir: <FolderOpenOutlined />,
  workspace_delete: <FolderOpenOutlined />,
  workspace_info: <FolderOpenOutlined />,
};

const toolTitles = {
  weather: 'Погода',
  currency: 'Курс валют',
  facts: 'Факт',
  web_search: 'Пошук в інтернеті',
  image_search: 'Пошук картинок',
  workspace_info: 'Робоча тека',
  workspace_list: 'Дивиться теку',
  workspace_read: 'Читає файл',
  workspace_write: 'Пише файл',
  workspace_mkdir: 'Створює теку',
  workspace_delete: 'Прибирає в кошик',
  create_brain_file: 'Записує в памʼять',
  create_brain_directory: 'Створює розділ памʼяті',
  list_brain_navigation: 'Переглядає памʼять',
};

/* Що саме бот зараз робить: не просто «викликаю інструмент», а конкретика —
   який запит шукає, яке місто, який файл пише. Аргументи приходять у
   payload.input події tool_start. */
function toolDetail(tool, input) {
  const args = input && typeof input === 'object' ? input : {};
  switch (tool) {
    case 'web_search':
    case 'image_search':
    case 'facts':
      return args.query ? `«${args.query}»` : '';
    case 'weather':
      return args.city || '';
    case 'currency':
      return args.base ? `${args.base} → ${args.target || 'UAH'}` : '';
    case 'workspace_list':
      return args.path || 'корінь';
    case 'workspace_read':
    case 'workspace_write':
    case 'workspace_mkdir':
    case 'workspace_delete':
    case 'create_brain_file':
    case 'create_brain_directory':
      return args.path || '';
    default: {
      const first = Object.values(args).find((v) => typeof v === 'string' && v.length < 120);
      return first || '';
    }
  }
}

/* Кроки інструментів із живим прогресом фетча (видно, що саме бот тягне з мережі).
   Спінер малює CSS через .tool-step-running::before. */
function ToolSteps({ steps }) {
  if (!steps || steps.length === 0) return null;
  return (
    <ul className="tool-steps tool-steps-inline">
      {steps.map((s) => {
        const toolName = toolTitles[s.tool] || s.tool;
        const icon = toolIcons[s.tool] || null;
        const detail = s.detail || toolDetail(s.tool, s.input);
        const hasError = s.type === 'done' && s.result?.error;
        const state =
          s.type === 'done' ? (hasError ? 'tool-step-error' : 'tool-step-done') : 'tool-step-running';
        return (
          <li key={s.id} className={`tool-step ${state}`}>
            <span className="tool-step-icon">{icon}</span>
            <span className="tool-step-name">{toolName}</span>
            {detail && <span className="tool-step-detail">{detail}</span>}
            <span className="tool-step-state">
              {s.type === 'done' ? (hasError ? s.result.error : 'готово') : 'працюю…'}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

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
  /* Довгі вставки не заливають поле вводу: вони стають вкладенням-чіпом,
     який відкривається як файл у міні-редакторі (див. handlePaste). */
  const [pastes, setPastes] = useState([]);
  const [editing, setEditing] = useState(null); // {uid, name, content, readOnly}
  const [messages, setMessages] = useState([]);
  const [sessionId, setSessionId] = useState(() => {
    try {
      return localStorage.getItem(SESSION_KEY) || '';
    } catch {
      return '';
    }
  });
  /* Список збережених чатів: розмови живуть на диску (chat_store.py), тож
     після перезавантаження сторінки чи рестарту панелі до них можна вернутись. */
  const [sessions, setSessions] = useState([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  /* Модель, якою РЕАЛЬНО відповіли (мозки перемикаються самі при збоях) */
  const [activeModel, setActiveModel] = useState('');
  const [activeBrain, setActiveBrain] = useState('');
  const abortRef = useRef(null);

  const refreshSessions = () =>
    api('/api/sessions')
      .then((r) => setSessions(r.sessions || []))
      .catch(() => {});

  useEffect(() => {
    refreshSessions();
  }, []);

  /* Тули, які виконує ЗОВНІШНІЙ мозок (OpenClaw через MCP), не проходять через
     стрім чату — вони прилітають окремим потоком подій /api/events. Підшиваємо
     їх до останнього повідомлення бота, щоб у баблі було видно кроки роботи:
     «шукає в мережі», «пише файл games/site/index.html». */
  useEffect(() => {
    const source = new EventSource('/api/events');
    source.onmessage = (event) => {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!payload || payload.type !== 'tool') return;
      setMessages((prev) => {
        const next = [...prev];
        let index = next.length - 1;
        while (index >= 0 && next[index].role !== 'ai') index -= 1;
        // Чіпляємо кроки лише до відповіді, яка ЗАРАЗ пишеться: інакше після
        // перезавантаження сторінки вони б осіли на старому повідомленні.
        if (index < 0 || !next[index].streaming) return prev;
        const steps = [...(next[index].toolSteps || [])];
        const id = `${payload.tool}-${payload.detail || ''}`;
        const existing = steps.findIndex((s) => s.id === id && s.type === 'start');
        if (payload.state === 'done' && existing >= 0) {
          steps[existing] = { ...steps[existing], type: 'done', result: {} };
        } else if (payload.state === 'start' && existing < 0) {
          steps.push({ id, type: 'start', tool: payload.tool, detail: payload.detail || '' });
        }
        next[index] = { ...next[index], toolSteps: steps };
        return next;
      });
    };
    return () => source.close();
  }, []);

  /* Відновлюємо останню відкриту розмову при завантаженні панелі */
  useEffect(() => {
    if (!sessionId || messages.length > 0) return;
    api(`/api/sessions/${encodeURIComponent(sessionId)}`)
      .then((data) => {
        const restored = (data.messages || []).map((m) => ({
          role: m.role === 'assistant' ? 'ai' : 'user',
          content: m.content,
          streaming: false,
          toolResults: [],
          toolSteps: [],
        }));
        if (restored.length) setMessages(restored);
      })
      .catch(() => {});
  }, [sessionId]);

  const openSession = async (sid) => {
    try {
      const data = await api(`/api/sessions/${encodeURIComponent(sid)}`);
      setMessages(
        (data.messages || []).map((m) => ({
          role: m.role === 'assistant' ? 'ai' : 'user',
          content: m.content,
          streaming: false,
          toolResults: [],
          toolSteps: [],
        }))
      );
      setSessionId(sid);
      try {
        localStorage.setItem(SESSION_KEY, sid);
      } catch {}
    } catch (e) {
      message.error(e.message);
    }
  };

  const newSession = () => {
    setMessages([]);
    setSessionId('');
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {}
    refreshSessions();
  };

  /* Список моделей + та, якою реально відповіли. Шапка має показувати
     ПРАВДУ: раніше там висіло «Claude Sonnet 5» із конфігу, хоча відповідав
     OpenClaw своєю моделлю. */
  const loadModels = () =>
    api('/api/models')
      .then((r) => {
        const list = (r.models || []).map((m) => ({
          value: m.id,
          label: m.label || m.id,
        }));
        setModels(list);
        if (r.selected) setSelectedModel(r.selected);
        if (r.active) setActiveModel(r.active);
        if (r.brain) setActiveBrain(r.brain);
      })
      .catch(() => setModels([]));

  useEffect(() => {
    loadModels();
  }, []);

  useEffect(() => {
    if (!selectedModel) return;
    fetch('/api/model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: selectedModel }),
    }).catch(() => {});
  }, [selectedModel]);

  /* Вставка «стіни тексту» (лог, код, стаття) не має перетворювати поле вводу
     на портянку: якщо вставлене довше за поріг — згортаємо його у вкладення,
     як це робить claude.ai. Текст нікуди не дівається: він іде в повідомлення
     цілком, а в панелі його видно як файл, що відкривається в редакторі. */
  const PASTE_CHARS = 800;
  const PASTE_LINES = 10;

  const handlePaste = (event) => {
    const text = event.clipboardData?.getData('text/plain') || '';
    if (!text) return;
    const lineCount = text.split('\n').length;
    if (text.length < PASTE_CHARS && lineCount < PASTE_LINES) return;
    event.preventDefault();
    setPastes((prev) => [
      ...prev,
      {
        uid: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: `Вставлений текст ${prev.length + 1}.txt`,
        content: text,
      },
    ]);
  };

  /* Розпізнане голосом дописуємо до вже набраного, а не затираємо його. */
  const appendVoiceText = (text) => {
    setInput((prev) => (prev ? `${prev.replace(/\s+$/, '')} ${text}` : text));
  };

  const handleSubmit = async (value) => {
    const text = value.trim();
    if (!text && files.length === 0 && pastes.length === 0) return;

    const fileLinks = files
      .filter((f) => f.status === 'done' && f.url)
      .map((f) => `[${f.name}](${f.url})`)
      .join('\n');

    /* Моделі віддаємо вставки повністю (у рамці з іменем), а в баблі
       користувача лишається тільки те, що він реально набрав, + чіпи. */
    const pasteBlocks = pastes
      .map((p) => `--- ${p.name} ---\n${p.content}`)
      .join('\n\n');

    const userContent = [text, pasteBlocks, fileLinks].filter(Boolean).join('\n\n');
    const attachments = pastes.map((p) => ({ ...p }));

      setInput('');
      setFiles([]);
      setPastes([]);
      setLoading(true);

      const botIndex = messages.length + 1;
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: text || fileLinks, attachments },
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
                    if (payload.model) setActiveModel(payload.model);
                    if (payload.mode) setActiveBrain(payload.mode);
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
        // Назву новому чату бот придумує у фоні — перепитуємо список трохи
        // згодом, інакше в боковій панелі лишався б заголовок-заглушка.
        refreshSessions();
        setTimeout(refreshSessions, 4000);
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
          /* Порожній список НЕ затирає кроки: коли тули виконує зовнішній мозок,
             вони приходять окремим потоком /api/events, а стрім чату шле [] —
             і раніше фінальна подія done стирала все, що встигло показатись. */
          toolSteps: toolSteps && toolSteps.length ? toolSteps : next[index].toolSteps || [],
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
        const attachments = msg.attachments || [];
        return {
          key: index,
          role: msg.role,
          content: msg.content,
          streaming: msg.streaming,
          toolResults,
          toolSteps: msg.toolSteps || [],
          mode: msg.mode || '',
          /* Увага: Bubble НЕ передає `info.streaming` (у його API є лише
             status/key/extraInfo), тому беремо ознаку стрімінгу з власного
             стану повідомлення (msg.streaming), який ставить updateBotMessage. */
          contentRender:
            msg.role === 'user'
              ? attachments.length > 0
                ? (content) => (
                    <div className="user-content" style={{ whiteSpace: 'pre-wrap' }}>
                      {content}
                      <div className="paste-chips">
                        {attachments.map((att) => (
                          <button
                            key={att.uid}
                            type="button"
                            className="paste-chip"
                            onClick={() => setEditing({ ...att, readOnly: true })}
                            title="Відкрити в редакторі"
                          >
                            <FileTextOutlined /> {att.name}
                            <span className="paste-chip-size">
                              {att.content.split('\n').length} рядк.
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                : undefined
              : msg.role === 'ai'
              ? (content) => (
                  <div className={`markdown-body${msg.streaming ? ' is-streaming' : ''}`}>
                    {/* Кроки інструментів видно й ПІСЛЯ появи тексту — раніше вони
                        жили лише в loadingRender і зникали з першим же токеном. */}
                    <ToolSteps steps={msg.toolSteps} />
                    <XMarkdown
                      streaming={
                        msg.streaming
                          ? { ...STREAM_ANIMATION, hasNextChunk: true }
                          : STREAM_DONE
                      }
                    >
                      {content}
                    </XMarkdown>
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
      avatar: { icon: <ClaudeMark size={15} />, style: { background: '#C96442', color: '#fff' } },
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
                <div className="chat-loading-title">
                  <ToolOutlined /> використовую інструменти…
                </div>
                <ToolSteps steps={steps} />
              </div>
            ) : (
              'бот думає…'
            )}
          </div>
        );
      },
      /* Фолбек на рівні ролі: стан стрімінгу беремо з items за ключем бабла. */
      contentRender: (content, info) => {
        const item = items.find((it) => String(it.key) === String(info?.key));
        const isStreaming = !!item?.streaming;
        return (
          <div className={`markdown-body${isStreaming ? ' is-streaming' : ''}`}>
            <ToolSteps steps={item?.toolSteps} />
            <XMarkdown
              streaming={
                isStreaming ? { ...STREAM_ANIMATION, hasNextChunk: true } : STREAM_DONE
              }
            >
              {content}
            </XMarkdown>
          </div>
        );
      },
    },
  };

  /* Модель відповіді не з нашого списку → показуємо її окремим пунктом */
  const activeIsExternal = !!activeModel && !models.some((m) => m.value === activeModel);

  const sessionList = (
    <SessionList
      sessions={sessions}
      activeId={sessionId}
      onOpen={(sid) => {
        openSession(sid);
        setDrawerOpen(false);
      }}
      onNew={() => {
        newSession();
        setDrawerOpen(false);
      }}
    />
  );

  return (
    <div className="chat-layout">
      {/* На широкому екрані список чатів завжди збоку, на вузькому —
          ховається під кнопку зліва й виїжджає шухлядою. */}
      <aside className="chat-sidebar">{sessionList}</aside>

      <Drawer
        open={drawerOpen}
        placement="left"
        width={300}
        onClose={() => setDrawerOpen(false)}
        styles={{ body: { padding: 0 } }}
        title="Чати"
        destroyOnClose
      >
        {drawerOpen ? sessionList : null}
      </Drawer>

      <div className="chat-panel">
        <div className="chat-panel-header">
          <Button
            className="chat-sidebar-toggle"
            type="text"
            icon={<MenuOutlined />}
            onClick={() => setDrawerOpen(true)}
            title="Мої чати"
          />

          <div className="chat-panel-model">
            <select
              value={activeIsExternal ? '__active__' : selectedModel}
              onChange={(e) => e.target.value !== '__active__' && setSelectedModel(e.target.value)}
              disabled={models.length === 0}
              title={
                activeIsExternal
                  ? `Відповідає ${activeBrain}: ${activeModel}. Вибір нижче — запасний мозок Omni.`
                  : 'Модель Omni'
              }
            >
              {/* Модель, яка РЕАЛЬНО відповідає, коли вона не з нашого списку
                  (напр. власна модель агента OpenClaw) — щоб шапка не брехала. */}
              {activeIsExternal && (
                <option value="__active__">{activeModel}</option>
              )}
              {models.length === 0 && <option value="">— недоступно —</option>}
              {models.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            {activeModel && (
              <span className="chat-model-live" title="Мозок, який реально відповів">
                {activeBrain ? `${activeBrain} · ${activeModel}` : activeModel}
              </span>
            )}
          </div>

          <Button
            type="text"
            icon={<PlusOutlined />}
            onClick={newSession}
            title="Новий чат"
            className="chat-new-btn"
          />
        </div>

        <div className="chat-body" onPasteCapture={handlePaste}>
          <div className="chat-messages">
            <Bubble.List items={items} roles={roles} autoScroll />
          </div>

          <div className="chat-input-area">
        {pastes.length > 0 && (
          <div className="paste-chips">
            {pastes.map((p) => (
              <div key={p.uid} className="paste-chip-wrap">
                <button
                  type="button"
                  className="paste-chip"
                  onClick={() => setEditing({ ...p, readOnly: false })}
                  title="Відкрити в редакторі"
                >
                  <FileTextOutlined /> {p.name}
                  <span className="paste-chip-size">{p.content.split('\n').length} рядк.</span>
                </button>
                <button
                  type="button"
                  className="paste-chip-remove"
                  onClick={() => setPastes((prev) => prev.filter((x) => x.uid !== p.uid))}
                  title="Прибрати"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

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

        <Sender
          value={input}
          onChange={(v) => setInput(v)}
          onSubmit={handleSubmit}
          loading={loading}
          placeholder="Повідомлення для бота…"
          allowSpeech={false}
          components={{ input: BlurTypingInput }}
          /* Один рядок, що росте: так текст стоїть на одній висоті з кнопками
             «+» і «відправити», а комфортну висоту поля дає падінг картки. */
          autoSize={{ minRows: 1, maxRows: 10 }}
          /* suffix — це «хвіст» смуги вводу, де живе кнопка відправки
             (у Sender v2 немає props actions). Ставимо мікрофон перед нею. */
          suffix={(oriNode) => (
            <span className="sender-actions">
              {/* Голосовий режим переїхав сюди — поруч із мікрофоном, бо це
                  про ту саму розмову голосом, а не про налаштування панелі. */}
              <Tooltip title="Розмова голосом">
                <Button
                  type="text"
                  className="voice-mode-btn"
                  icon={<VoiceWave />}
                  onClick={() => window.openVoiceMode?.()}
                />
              </Tooltip>
              <MicButton onText={appendVoiceText} disabled={loading} />
              {oriNode}
            </span>
          )}
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

      {/* Міні-редактор вставленого тексту: вставку видно й можна правити
          до відправки; у вже надісланому повідомленні — лише читання. */}
      <Modal
        open={!!editing}
        title={editing?.name}
        onCancel={() => setEditing(null)}
        width="min(900px, 92vw)"
        footer={
          editing?.readOnly ? (
            <Button onClick={() => setEditing(null)}>Закрити</Button>
          ) : (
            [
              <Button key="cancel" onClick={() => setEditing(null)}>
                Скасувати
              </Button>,
              <Button
                key="save"
                type="primary"
                onClick={() => {
                  setPastes((prev) =>
                    prev.map((p) => (p.uid === editing.uid ? { ...p, content: editing.content } : p))
                  );
                  setEditing(null);
                }}
              >
                Зберегти
              </Button>,
            ]
          )
        }
      >
        {editing && (
          <CodeEditor
            value={editing.content}
            filename={editing.name}
            readOnly={editing.readOnly}
            onChange={(val) => setEditing((prev) => (prev ? { ...prev, content: val } : prev))}
          />
        )}
        </Modal>
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
