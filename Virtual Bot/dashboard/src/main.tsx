import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ClerkProvider } from '@clerk/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './app/App';
import { AuthGate } from './components/shell/AuthCorner';
import { ToastProvider } from './components/ui/Toaster';
import { setAuthDisabled } from './lib/auth';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Панель дивиться на локальний бекенд: мережа безкоштовна, але зайві
      // перезапити на кожен фокус вікна смикають health-перевірки сервісів.
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 5_000,
    },
  },
});

/*
 * Бекенд — єдине джерело правди про те, чи ввімкнено гейт (/api/auth/config).
 * Помилка запиту = лишаємо гейт: краще зайвий раз попросити вхід, ніж
 * випадково відкрити панель, коли бекенд справді її захищає.
 */
async function boot() {
  let authDisabled = false;
  try {
    const response = await fetch('/api/auth/config');
    if (response.ok) authDisabled = !!(await response.json()).disabled;
  } catch {
    authDisabled = false;
  }
  setAuthDisabled(authDisabled);

  const tree = (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </QueryClientProvider>
  );

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {authDisabled ? (
        tree
      ) : (
        <ClerkProvider afterSignOutUrl="/">
          <AuthGate>{tree}</AuthGate>
        </ClerkProvider>
      )}
    </StrictMode>,
  );
}

void boot();
