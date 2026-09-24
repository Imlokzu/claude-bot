import { authHeaders } from './auth';
import { t } from './i18n';
import type { ToolStep } from '../panels/chat/types';

/*
 * Стрім відповіді бота.
 *
 * /api/chat відповідає text/event-stream, але запит — POST, тому EventSource
 * тут не годиться: він уміє лише GET. Читаємо тіло вручну.
 *
 * Іменовані події з бекенда (main.py, stream_response):
 *   delta         — шматок тексту
 *   emotion       — емоція обличчя (прилітає рано, ще до кінця відповіді)
 *   tool_start / tool_progress / tool_done / tool_result — хід тулзів
 *   done          — фінальна відповідь + режим, модель, результати тулзів
 *   error         — збій
 */

export interface ToolEvent {
  type: 'tool_start' | 'tool_progress' | 'tool_done' | 'tool_result' | 'tool_error';
  call_id?: string;
  input?: unknown;
  is_error?: boolean;
  step?: ToolStep;
  tool?: string;
  detail?: string;
  result?: unknown;
  [key: string]: unknown;
}

export interface ChatDone {
  reply: string;
  emotion: string;
  session_id: string;
  mode: string;
  model: string;
  tool_results: unknown[];
  steps?: ToolStep[];
}

export interface ChatAttachment {
  url: string;
  name: string;
  type: string;
  size?: number;
}

export type AgentStatus = 'connecting' | 'running' | 'unavailable' | 'disconnected';

export interface ChatHandlers {
  onDelta?: (chunk: string) => void;
  onEmotion?: (emotion: string) => void;
  onTool?: (event: ToolEvent) => void;
  onStatus?: (status: AgentStatus) => void;
  onModel?: (model: string) => void;
  onSession?: (sessionId: string) => void;
  onDone?: (result: ChatDone) => void;
  onError?: (message: string) => void;
}

export interface ChatPayload {
  message: string;
  session_id?: string;
  attachments?: ChatAttachment[];
  participant_name?: string;
  reasoning_effort?: string;
  voice?: boolean;
  history?: unknown[];
}

/** Remove an internal model emotion marker before text reaches the transcript. */
export function cleanEmotionTag(text: string): string {
  return text
    .replace(/\[\s*(?:емоція|емоцiя|emotion)\s*[:：]\s*[a-zA-Zа-яіїєґА-ЯІЇЄҐʼ'-]+\s*\]/giu, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/**
 * Шле репліку й розбирає потік. `signal` дозволяє перервати відповідь —
 * кнопка «Стоп» у чаті саме це й робить.
 */
export async function streamChat(
  payload: ChatPayload,
  handlers: ChatHandlers,
  signal?: AbortSignal,
  endpoint = '/api/chat',
): Promise<void> {
  const headers = await authHeaders({ 'Content-Type': 'application/json' });

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...payload, stream: true }),
    signal,
  });

  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => null);
    const detail =
      data && typeof data === 'object'
        ? String((data as Record<string, unknown>).detail ?? `HTTP ${response.status}`)
        : `HTTP ${response.status}`;
    handlers.onError?.(detail);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');

      // Keep incomplete frames buffered, including split CRLF boundaries.
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (dispatch(frame, handlers)) return;
        boundary = buffer.indexOf('\n\n');
      }
    }
    if (buffer.trim() && dispatch(buffer, handlers)) return;
    handlers.onError?.(t('chat.incomplete'));
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function dispatch(frame: string, handlers: ChatHandlers): boolean {
  let name = 'message';
  const dataLines: string[] = [];

  for (const line of frame.split('\n')) {
    if (line.startsWith(':')) continue; // keep-alive
    if (line.startsWith('event:')) name = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }

  if (!dataLines.length) return false;

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(dataLines.join('\n'));
  } catch {
    return false;
  }
  if (!data || typeof data !== 'object') return false;

  switch (name) {
    case 'session':
      if (typeof data.session_id === 'string') handlers.onSession?.(data.session_id);
      break;
    case 'delta':
      handlers.onDelta?.(String(data.chunk ?? ''));
      break;
    case 'emotion':
      handlers.onEmotion?.(String(data.emotion ?? 'idle'));
      break;
    case 'tool_start':
    case 'tool_progress':
    case 'tool_done':
    case 'tool_result':
    case 'tool_error':
      handlers.onTool?.({ ...data, type: name } as ToolEvent);
      break;
    case 'agent_status':
      if (['connecting', 'running', 'unavailable', 'disconnected'].includes(String(data.status))) {
        handlers.onStatus?.(data.status as AgentStatus);
      }
      break;
    case 'model': {
      const provider = String(data.provider ?? '').trim();
      const model = String(data.model ?? '').trim();
      if (provider && model) handlers.onModel?.(`${provider}/${model}`);
      break;
    }
    case 'done':
      handlers.onDone?.({ ...data, reply: cleanEmotionTag(String(data.reply ?? '')) } as unknown as ChatDone);
      return true;
    case 'error':
      handlers.onError?.(String(data.error ?? t('chat.unknownError')));
      return true;
  }
  return false;
}
