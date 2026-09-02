let _getToken = null;
/* Локальний режим (CLERK_DISABLED=1 на бекенді): гейт вимкнено, токен не
   потрібен. Прапорець ставить main.jsx ДО монтування — компоненти Clerk у
   цьому режимі не рендеряться взагалі, бо без ClerkProvider вони кидають. */
let _disabled = false;
export function setAuthDisabled(v) { _disabled = !!v; }
export function isAuthDisabled() { return _disabled; }
export function setClerkTokenGetter(fn) { _getToken = typeof fn === "function" ? fn : null; }
export async function getAuthToken() {
  if (!_getToken) return "";
  try { const t = await _getToken(); return typeof t === "string" ? t : ""; } catch { return ""; }
}
export async function authHeaders(extra = {}) {
  const token = await getAuthToken();
  if (!token) return { ...extra };
  return { ...extra, Authorization: `Bearer ${token}` };
}
export async function authFetch(url, options = {}) {
  const token = await getAuthToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(url, { ...options, headers });
}
export async function authEventSourceUrlAsync(url) {
  const token = await getAuthToken();
  try { const u = new URL(url, window.location.origin); if (token) u.searchParams.set("token", token); return u.toString(); } catch { return url; }
}
