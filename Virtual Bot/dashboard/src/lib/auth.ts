/*
 * Міст до Clerk. Токен зберігається не в стані React, а тут: його просять
 * і запити TanStack Query, і EventSource, і завантаження файлів — усі поза
 * деревом компонентів.
 *
 * Локальний режим (CLERK_DISABLED=1 на бекенді) вимикає гейт повністю:
 * компоненти Clerk у ньому не рендеряться взагалі, бо без валідного ключа
 * ClerkProvider кидає ще на старті.
 */

type TokenGetter = () => Promise<string | null>;

let getter: TokenGetter | null = null;
let disabled = false;

export function setAuthDisabled(value: boolean): void {
  disabled = !!value;
}

export function isAuthDisabled(): boolean {
  return disabled;
}

export function setTokenGetter(fn: TokenGetter | null): void {
  getter = typeof fn === 'function' ? fn : null;
}

export async function getToken(): Promise<string> {
  if (!getter) return '';
  try {
    const token = await getter();
    return typeof token === 'string' ? token : '';
  } catch {
    return '';
  }
}

export async function authHeaders(extra: HeadersInit = {}): Promise<Headers> {
  const headers = new Headers(extra);
  const token = await getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return headers;
}

/**
 * EventSource не вміє заголовків, тож токен їде параметром запиту —
 * так само, як це робила стара панель.
 */
export async function authStreamUrl(path: string): Promise<string> {
  const token = await getToken();
  try {
    const url = new URL(path, window.location.origin);
    if (token) url.searchParams.set('token', token);
    return url.toString();
  } catch {
    return path;
  }
}
