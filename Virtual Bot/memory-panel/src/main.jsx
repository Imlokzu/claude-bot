import React from 'react'
import ReactDOM from 'react-dom/client'
import { ClerkProvider } from '@clerk/react'
import App from './App.jsx'
import AuthGate from './AuthGate.jsx'
import { setAuthDisabled } from './auth.js'
import './styles.css'
import './auth.css'

/* Чи вимкнено вхід — питаємо бекенд (/api/auth/config). Помилка запиту =
   лишаємо гейт: краще зайвий раз попросити вхід, ніж відкрити панель. */
async function boot() {
  let authDisabled = false
  try {
    const r = await fetch('/api/auth/config')
    if (r.ok) authDisabled = !!(await r.json()).disabled
  } catch {
    authDisabled = false
  }
  setAuthDisabled(authDisabled)

  const node = document.getElementById('memory-panel-root')
  if (!node) return
  // Локальний режим: без ClerkProvider — він кидає без валідного ключа.
  const tree = authDisabled
    ? <App />
    : <ClerkProvider afterSignOutUrl="/"><AuthGate><App /></AuthGate></ClerkProvider>
  ReactDOM.createRoot(node).render(<React.StrictMode>{tree}</React.StrictMode>)
}

boot()
