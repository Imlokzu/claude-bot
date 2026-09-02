/**
 * Клієнт бекенду «Клод Бота».
 *
 * Свідомо БЕЗ платформенних залежностей: ні DOM, ні React Native, ні Node.
 * Усе, що залежить від платформи (звідки взяти fetch, де взяти токен, яка
 * базова адреса), передається зовні. Через це один і той самий клієнт
 * працює в браузері, у Expo Go на телефоні та в Electron.
 */

import type {
  AuthConfig,
  ChatMode,
  ChatReply,
  ChatRequest,
  CodeStatus,
  ModelsResponse,
  Project,
  SessionDetail,
  SessionSummary,
} from './types';

/** Мінімальний контракт fetch — щоб не тягнути в ядро типи DOM. */
type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: unknown;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

export interface ClientOptions {
  /**
   * Адреса бекенду. У браузері за замовчуванням порожня (той самий origin),
   * але в Expo Go на телефоні застосунок НЕ на тому ж хості, що бекенд, —
   * там треба явний http://<ip-компʼютера>:8100.
   */
  baseUrl?: string;
  /** Звідки брати Bearer-токен. Порожній рядок = ходити без авторизації. */
  getToken?: () => Promise<string> | string;
  /** Реалізація fetch. За замовчуванням — глобальна. */
  fetch?: FetchLike;
}

/** Помилка з бекенду з живим кодом статусу — щоб UI міг відрізнити 503 від 400. */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export class BotClient {
  private readonly baseUrl: string;
  private readonly getToken?: () => Promise<string> | string;
  private readonly doFetch: FetchLike;

  constructor(opts: ClientOptions = {}) {
    // Без кінцевого слеша: усі шляхи нижче починаються з «/».
    this.baseUrl = (opts.baseUrl ?? '').replace(/\/+$/, '');
    this.getToken = opts.getToken;
    const f = opts.fetch ?? (globalThis as { fetch?: FetchLike }).fetch;
    if (!f) {
      throw new Error(
        'Немає fetch: передайте його через ClientOptions.fetch (середовище без глобального fetch)',
      );
    }
    // Обовʼязково привʼязуємо до globalThis. Браузерний fetch — це метод
    // Window: збережений у полі й викликаний як this.doFetch(...) він отримує
    // receiver'ом сам клієнт і кидає «Illegal invocation».
    this.doFetch = (url, init) => f.call(globalThis, url, init);
  }

  private async request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    const headers: Record<string, string> = {};
    if (init?.body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.getToken) {
      const token = await this.getToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
    }
    const res = await this.doFetch(this.baseUrl + path, {
      method: init?.method ?? 'GET',
      headers,
      ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
    if (!res.ok) {
      // Бекенд віддає {"detail": "..."} — показуємо саме його, а не «500».
      let detail = `HTTP ${res.status}`;
      try {
        const data = (await res.json()) as { detail?: unknown };
        if (typeof data?.detail === 'string' && data.detail) detail = data.detail;
      } catch {
        /* тіло не JSON — лишаємо код статусу */
      }
      throw new ApiError(res.status, detail);
    }
    return (await res.json()) as T;
  }

  // ---- налаштування середовища ------------------------------------------

  /** Чи ввімкнено вхід. Дає змогу не піднімати Clerk у локальному режимі. */
  authConfig(): Promise<AuthConfig> {
    return this.request<AuthConfig>('/api/auth/config');
  }

  // ---- моделі ------------------------------------------------------------

  models(): Promise<ModelsResponse> {
    return this.request<ModelsResponse>('/api/models');
  }

  /**
   * Вибір моделі — стан НА БЕКЕНДІ, а не параметр запиту: /api/chat моделі не
   * приймає. Тому перед надсиланням треба перемкнути її окремо.
   */
  selectModel(model: string): Promise<{ ok: boolean; selected: string }> {
    return this.request('/api/model', { method: 'POST', body: { model } });
  }

  // ---- розмови -----------------------------------------------------------

  sessions(mode: ChatMode = 'chat'): Promise<{ sessions: SessionSummary[] }> {
    // Кодинг має власний простір розмов — інакше задачі для агента
    // змішалися б зі звичайними чатами.
    return this.request(`/api/sessions?kind=${encodeURIComponent(mode)}`);
  }

  session(id: string, mode: ChatMode = 'chat'): Promise<SessionDetail> {
    return this.request(`/api/sessions/${encodeURIComponent(id)}?kind=${encodeURIComponent(mode)}`);
  }

  deleteSession(id: string, mode: ChatMode = 'chat'): Promise<{ ok: boolean }> {
    return this.request(`/api/sessions/${encodeURIComponent(id)}?kind=${encodeURIComponent(mode)}`, { method: 'DELETE' });
  }

  pinSession(id: string, pinned: boolean, mode: ChatMode = 'chat'): Promise<{ ok: boolean }> {
    return this.request(`/api/sessions/${encodeURIComponent(id)}/pin?kind=${encodeURIComponent(mode)}`, {
      method: 'POST',
      body: { pinned },
    });
  }

  // ---- чат ---------------------------------------------------------------

  chat(req: ChatRequest): Promise<ChatReply> {
    return this.request<ChatReply>('/api/chat', { method: 'POST', body: req });
  }

  // ---- кодинг-режим ------------------------------------------------------

  codeStatus(): Promise<CodeStatus> {
    return this.request<CodeStatus>('/api/code/status');
  }

  /**
   * Вибір моделі кодингу. Бекенд гасить живі процеси omp сам: модель
   * передається аргументом --model під час запуску, тож уже піднятий
   * процес далі працював би старою.
   */
  selectCodeModel(model: string): Promise<{ ok: boolean; selected: string }> {
    return this.request('/api/code/model', { method: 'POST', body: { model } });
  }

  projects(): Promise<{ projects: Project[] }> {
    return this.request('/api/projects');
  }

  stopCode(sessionId: string): Promise<{ ok: boolean; stopped: boolean }> {
    return this.request('/api/code/stop', { method: 'POST', body: { session_id: sessionId } });
  }

  /**
   * Адреса SSE-стріму кодингу. Сам стрім читає платформенний шар: у браузері
   * це EventSource, у React Native — fetch із ReadableStream, і єдиного API
   * для обох немає.
   */
  codeChatUrl(): string {
    return this.baseUrl + '/api/code/chat';
  }

  /** Абсолютна адреса — для картинок і файлів, які бекенд віддає за шляхом. */
  absolute(path: string): string {
    if (/^https?:\/\//.test(path)) return path;
    return this.baseUrl + path;
  }
}
