import React from 'react';
import { Show, SignInButton, SignUpButton, UserButton, useAuth } from '@clerk/react';
let _getToken: ((opts?: unknown) => Promise<string | null>) | null = null;
export function setClerkTokenGetter(fn: typeof _getToken) { _getToken = fn; }
export async function getAuthToken() {
  if (!_getToken) return "";
  try { const t = await _getToken(); return typeof t === "string" ? t : ""; } catch { return ""; }
}
function TokenBridge() {
  const { getToken } = useAuth();
  React.useEffect(() => { setClerkTokenGetter(getToken); return () => setClerkTokenGetter(null); }, [getToken]);
  return null;
}
export function AuthGate({ children }: { children: React.ReactNode }) {
  return (
    <>
      <TokenBridge />
      <Show when="signed-out">
        <div style={{ minHeight: "50vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ width: "min(520px,100%)", background: "#fffaf2", border: "1px solid #c6d7c2", borderRadius: 20, padding: 24 }}>
            <div style={{ fontWeight: 800, letterSpacing: ".12em", fontSize: 12, color: "#3b4a3e" }}>▞▚ CLAUDE BOT STUDIO</div>
            <h1 style={{ margin: "12px 0 8px", fontSize: 22, fontWeight: 800, color: "#3b4a3e" }}>Увійдіть, щоб налаштувати бота</h1>
            <p style={{ margin: 0, color: "#657968", lineHeight: 1.6, fontSize: 13 }}>Без входу налаштування недоступні. Кожен акаунт — окремий бот.</p>
            <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
              <SignInButton mode="modal"><button type="button" style={{ padding: "10px 18px", borderRadius: 999, border: "1px solid #6c806f", background: "#6c806f", color: "#fffaf0", fontWeight: 800, cursor: "pointer" }}>Увійти</button></SignInButton>
              <SignUpButton mode="modal"><button type="button" style={{ padding: "10px 18px", borderRadius: 999, border: "1px solid #c6d7c2", background: "#fff", color: "#3b4a3e", fontWeight: 700, cursor: "pointer" }}>Реєстрація</button></SignUpButton>
            </div>
          </div>
        </div>
      </Show>
      <Show when="signed-in">{children}</Show>
    </>
  );
}
export function TopbarAuth() {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <Show when="signed-out">
        <SignInButton mode="modal"><button type="button" style={{ padding: "7px 14px", borderRadius: 999, border: "1px solid #6c806f", background: "#6c806f", color: "#fffaf0", fontWeight: 800, fontSize: 13, cursor: "pointer" }}>Увійти</button></SignInButton>
        <SignUpButton mode="modal"><button type="button" style={{ padding: "7px 14px", borderRadius: 999, border: "1px solid #c6d7c2", background: "#fff", color: "#3b4a3e", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Реєстрація</button></SignUpButton>
      </Show>
      <Show when="signed-in"><UserButton afterSignOutUrl="/" /></Show>
    </span>
  );
}
