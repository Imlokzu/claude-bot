import { authHeaders } from './auth';

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
  type: 'tool_start' | 'tool_progress' | 'tool_done' | 'tool_result';
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
}

export interface ChatHandlers {
  onDelta?: (chunk: string) => void;
  onEmotion?: (emotion: string) => void;
  onTool?: (event: ToolEvent) => void;
  onDone?: (result: ChatDone) => void;
  onError?: (message: string) => void;
}

export interface ChatPayload {
  message: string;
  session_id?: string;
  attachments?: unknown[];
  participant_name?: string;
  reasoning_effort?: string;
  voice?: boolean;
  history?: unknown[];
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

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Кадри SSE розділені порожнім рядком. Останній шматок лишаємо в буфері:
    // він майже напевно обірваний посеред кадру.
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      dispatch(frame, handlers);
      boundary = buffer.indexOf('\n\n');
    }
  }

  if (buffer.trim()) dispatch(buffer, handlers);
}

function dispatch(frame: string, handlers: ChatHandlers): void {
  let name = 'message';
  const dataLines: string[] = [];

  for (const line of frame.split('\n')) {
    if (line.startsWith(':')) continue; // keep-alive
    if (line.startsWith('event:')) name = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }

  if (!dataLines.length) return;

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(dataLines.join('\n'));
  } catch {
    return;
  }

  switch (name) {
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
      handlers.onTool?.({ ...data, type: name } as ToolEvent);
      break;
    case 'done':
      handlers.onDone?.(data as unknown as ChatDone);
      break;
    case 'error':
      handlers.onError?.(String(data.error ?? 'Невідома помилка'));
      break;
  }
}
