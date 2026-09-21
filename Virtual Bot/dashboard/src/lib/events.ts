import { authStreamUrl } from './auth.ts';

/*
 * Живі події бота (/api/events).
 *
 * Один EventSource на всю панель, а не по одному на віджет: бекенд тримає
 * чергу на кожну підписку, і десяток з'єднань з однієї вкладки — це десяток
 * черг, які він мусить наповнювати однаковим. Тому тут шина: з'єднання
 * піднімається з першим підписником і гасне з останнім.
 *
 * Формат дроту — "data: {json}" без імені події; тип лежить у полі `type`.
 */

export type BotEvent =
  | { type: 'emotion'; emotion: string }
  | { type: 'say'; text: string; emotion: string }
  | { type: 'reply'; text: string; emotion: string }
  | { type: 'tool'; tool: string; detail?: string; state?: string }
  | { type: 'screen'; screen: string }
  | { type: 'music'; action: string; track?: Record<string, unknown> }
  | { type: 'video'; action: string; [key: string]: unknown }
  | { type: 'ui'; kind: string; data: Record<string, unknown> }
  | { type: 'preview'; path: string }
  | { type: 'vision'; event: string; faces: number }
  | { type: 'log'; t: number; level: string; name: string; msg: string }
  | { type: string; [key: string]: unknown };

type Listener = (event: BotEvent) => void;
type StatusListener = (connected: boolean) => void;

const listeners = new Set<Listener>();
const statusListeners = new Set<StatusListener>();

let source: EventSource | null = null;
let opening: Promise<void> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let attempt = 0;
let connected = false;

function setConnected(value: boolean): void {
  if (connected === value) return;
  connected = value;
  statusListeners.forEach((fn) => fn(value));
}

async function connect(): Promise<void> {
  const url = await authStreamUrl('/api/events');
  // The last listener may have unsubscribed while the auth token was loading.
  if (!listeners.size) return;

  const es = new EventSource(url);
  source = es;

  es.onopen = () => {
    attempt = 0;
    setConnected(true);
  };

  es.onmessage = (message) => {
    let payload: BotEvent;
    try {
      payload = JSON.parse(message.data);
    } catch {
      return; // keep-alive або побитий кадр — мовчки пропускаємо
    }
    listeners.forEach((fn) => {
      try {
        fn(payload);
      } catch (error) {
        // Один зламаний підписник не має гасити стрічку для решти.
        console.error('Підписник подій кинув помилку', error);
      }
    });
  };

  es.onerror = () => {
    setConnected(false);
    es.close();
    if (source === es) source = null;
    if (!listeners.size) return;
    // Відступ із межею: бекенд міг перезапуститись, і довбати його щосекунди
    // сенсу немає, але й чекати хвилину користувач не має.
    attempt = Math.min(attempt + 1, 5);
    const delay = Math.min(500 * 2 ** attempt, 10_000);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void open();
    }, delay);
  };
}

function open(): Promise<void> {
  if (source || !listeners.size) return Promise.resolve();
  // Several widgets mount in the same React commit. Keep the asynchronous
  // token lookup single-flight so they cannot each open their own SSE stream.
  if (!opening) {
    opening = connect().finally(() => {
      opening = null;
    });
  }
  return opening;
}

function closeIfIdle(): void {
  if (listeners.size) return;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  source?.close();
  source = null;
  setConnected(false);
}

/** Підписка на всі події. Повертає функцію відписки. */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  void open();
  return () => {
    listeners.delete(listener);
    closeIfIdle();
  };
}

/** Підписка на стан з'єднання зі стрічкою. */
export function subscribeStatus(listener: StatusListener): () => void {
  statusListeners.add(listener);
  listener(connected);
  return () => {
    statusListeners.delete(listener);
  };
}
