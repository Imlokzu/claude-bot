import React from 'react';
import ReactDOM from 'react-dom/client';
import { ClerkProvider } from '@clerk/react';
import App from './App.jsx';
import WorkspaceApp from './WorkspaceApp.jsx';
import BrowserApp from './BrowserApp.jsx';
import AuthGate from './AuthGate.jsx';
import { setAuthDisabled } from './auth.js';
import './styles.css';
import './auth.css';

/* Три панелі живуть в одному бандлі (спільні antd + CodeMirror): монтуємо
   кожну лише якщо її корінь є на сторінці. */
const mount = (id, element, authDisabled) => {
  const node = document.getElementById(id);
  if (!node) return;
  // Локальний режим (CLERK_DISABLED=1): ClerkProvider не піднімаємо взагалі —
  // без валідного publishable key він кидає ще на старті.
  const tree = authDisabled
    ? element
    : <ClerkProvider afterSignOutUrl="/"><AuthGate>{element}</AuthGate></ClerkProvider>;
  ReactDOM.createRoot(node).render(<React.StrictMode>{tree}</React.StrictMode>);
};

/* Бекенд — єдине джерело правди про те, чи гейт увімкнено (/api/auth/config).
   Помилка запиту = лишаємо гейт: краще зайвий раз попросити вхід, ніж
   випадково відкрити панель, коли бекенд справді її захищає. */
async function boot() {
  let authDisabled = false;
  try {
    const r = await fetch('/api/auth/config');
    if (r.ok) authDisabled = !!(await r.json()).disabled;
  } catch {
    authDisabled = false;
  }
  setAuthDisabled(authDisabled);
  mount('chat-panel-root', <App />, authDisabled);
  mount('workspace-panel-root', <WorkspaceApp />, authDisabled);
  mount('browser-panel-root', <BrowserApp />, authDisabled);
}

boot();
