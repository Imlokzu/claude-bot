export const SESSION_KEY = 'virtual_bot_session_id'

export function getActiveSessionId() {
  return localStorage.getItem(SESSION_KEY) || ''
}

export function memoryRequestPath(path, params = {}) {
  const query = new URLSearchParams({
    ...params,
    session_id: getActiveSessionId()
  })
  return `${path}?${query.toString()}`
}
