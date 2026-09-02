import React from 'react';
import { Show, SignInButton, SignUpButton, UserButton, useAuth } from '@clerk/react';
import { setClerkTokenGetter, isAuthDisabled } from './auth.js';
function TokenBridge() {
  const { getToken } = useAuth();
  React.useEffect(() => { setClerkTokenGetter(getToken); return () => setClerkTokenGetter(null); }, [getToken]);
  return null;
}
export default function AuthGate({ children }) {
  return (
    <>
      <TokenBridge />
      <Show when="signed-out">
        <div className="auth-gate">
          <div className="auth-gate-card">
            <div className="auth-gate-brand"><span className="auth-gate-logo">▞▚</span><span className="auth-gate-title">КЛОД БОТ</span><span className="auth-gate-sub">· ВІРТУАЛЬНИЙ</span></div>
            <h1 className="auth-gate-h1">Увійдіть, щоб продовжити</h1>
            <p className="auth-gate-lead">Кожен акаунт — окремий бот. Без входу памʼять недоступна.</p>
            <div className="auth-gate-actions">
              <Show when="signed-out"><SignInButton mode="modal"><button type="button" className="auth-gate-btn auth-gate-btn-primary">Увійти</button></SignInButton></Show>
              <Show when="signed-out"><SignUpButton mode="modal"><button type="button" className="auth-gate-btn auth-gate-btn-ghost">Створити акаунт</button></SignUpButton></Show>
            </div>
          </div>
        </div>
      </Show>
      <Show when="signed-in">{children}</Show>
    </>
  );
}
export function TopbarAuth() {
  // Локальний режим: жодного компонента Clerk — лише чесна позначка.
  if (isAuthDisabled()) {
    return (
      <div className="auth-topbar">
        <span className="auth-local-badge" title="CLERK_DISABLED=1 — вхід вимкнено для локальної розробки">локально</span>
      </div>
    );
  }
  return (
    <div className="auth-topbar">
      <Show when="signed-out">
        <SignInButton mode="modal"><button type="button" className="auth-btn auth-btn-primary">Увійти</button></SignInButton>
        <SignUpButton mode="modal"><button type="button" className="auth-btn auth-btn-ghost">Реєстрація</button></SignUpButton>
      </Show>
      <Show when="signed-in"><UserButton afterSignOutUrl="/" /></Show>
    </div>
  );
}
