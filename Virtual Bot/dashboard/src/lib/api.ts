import { authHeaders } from './auth';

/** Помилка бекенда з розібраним повідомленням і кодом. */
export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * FastAPI повертає помилку в трьох різних формах залежно від шару:
 * {detail: "..."} від HTTPException, {detail: [{msg}]} від валідації pydantic,
 * {error: "..."} від наших власних ручок. Зводимо до одного рядка.
 */
function readError(payload: unknown, status: number): string {
  if (payload && typeof payload === 'object') {
    const body = payload as Record<string, unknown>;
    const raw = body.error ?? body.detail ?? body.message;
    if (typeof raw === 'string' && raw) return raw;
    if (Array.isArray(raw)) {
      const parts = raw
        .map((item) =>
          item && typeof item === 'object' && 'msg' in item
            ? String((item as { msg: unknown }).msg)
            : JSON.stringify(item),
        )
        .filter(Boolean);
      if (parts.length) return parts.join('; ');
    }
  }
  return `HTTP ${status}`;
}

export interface ApiOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Не додавати Content-Type (для FormData). */
  raw?: boolean;
}

/** Запит до бекенда з токеном, розбором помилок і типізованою відповіддю. */
export async function api<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
  const { body, raw, ...rest } = options;
  const headers = await authHeaders(rest.headers);

  let payload: BodyInit | undefined;
  if (body instanceof FormData || body instanceof Blob) {
    payload = body;
  } else if (body !== undefined) {
    if (!raw) headers.set('Content-Type', 'application/json');
    payload = typeof body === 'string' ? body : JSON.stringify(body);
  }

  const response = await fetch(path, { ...rest, headers, body: payload });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ApiError(readError(data, response.status), response.status);
  }

  // 204 та порожнє тіло — нормальна відповідь, а не помилка розбору.
  if (response.status === 204) return null as T;
  const text = await response.text();
  if (!text) return null as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

export const get = <T>(path: string) => api<T>(path);
export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body });
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });
