/*
 * Everything this app knows about the bot.
 *
 * The bot itself has no authentication — a guard in front of it does (see
 * Virtual Bot/tunnel_guard.py), and it accepts the shared key either as a
 * cookie or as a header. A native client sends the header: it keeps working
 * regardless of how the platform feels about cookies, and it means the key
 * never has to sit in a URL where it would end up in logs.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORE = 'klodbot.connection';

/** Splits a pasted unlock link into the parts each request needs. */
export function parseTarget(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!url.hostname) return null;
  return { base: url.origin, key: url.searchParams.get('key') || '' };
}

export async function saveConnection(conn) {
  await AsyncStorage.setItem(STORE, JSON.stringify(conn));
}

export async function loadConnection() {
  try {
    const raw = await AsyncStorage.getItem(STORE);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function clearConnection() {
  await AsyncStorage.removeItem(STORE);
}

function headers(conn) {
  const h = { 'Content-Type': 'application/json' };
  if (conn.key) h['x-klod-key'] = conn.key;
  return h;
}

/* A chat turn waits on a model and can legitimately run for a minute or more,
   so it gets its own generous deadline; everything else should be quick and a
   long hang there means something is wrong, not slow. */
async function call(conn, path, { method = 'GET', body, timeout = 15000 } = {}) {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), timeout);
  try {
    const response = await fetch(`${conn.base}${path}`, {
      method,
      headers: headers(conn),
      body: body ? JSON.stringify(body) : undefined,
      signal: stop.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export function getStatus(conn) {
  return call(conn, '/api/status');
}

export function sendMessage(conn, message, sessionId) {
  return call(conn, '/api/chat', {
    method: 'POST',
    body: { message, stream: false, session_id: sessionId },
    timeout: 180000,
  });
}
