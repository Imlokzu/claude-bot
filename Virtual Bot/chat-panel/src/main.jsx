import React from 'react';
import ReactDOM from 'react-dom/client';
import { ClerkProvider } from '@clerk/react';
import App from './App.jsx';
import WorkspaceApp from './WorkspaceApp.jsx';
import BrowserApp from './BrowserApp.jsx';
import './styles.css';

/* Три панелі живуть в одному бандлі (спільні antd + CodeMirror): монтуємо
   кожну лише якщо її корінь є на сторінці. */
const mount = (id, element) => {
  const node = document.getElementById(id);
  if (!node) return;
  ReactDOM.createRoot(node).render(
    <React.StrictMode>
      <ClerkProvider afterSignOutUrl="/">{element}</ClerkProvider>
    </React.StrictMode>
  );
};

mount('chat-panel-root', <App />);
mount('workspace-panel-root', <WorkspaceApp />);
mount('browser-panel-root', <BrowserApp />);
