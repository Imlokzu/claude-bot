import React from "react";
import { Show, SignInButton, SignUpButton, UserButton, useAuth } from "@clerk/react";
let _getToken = null;
export function setClerkTokenGetter(fn) { _getToken = typeof fn === "function" ? fn : null; }
export async function getAuthToken() {
  if (!_getToken) return "";
  try { const t = await _getToken(); return typeof t === "string" ? t : ""; } catch { return ""; }
}
function TokenBridge() {
  const { getToken } = useAuth();
  React.useEffect(() => { setClerkTokenGetter(getToken); return () => setClerkTokenGetter(null); }, [getToken]);
  return null;
}
export function AuthGate({ children }) {
  return (
    <>
      <TokenBridge />
      <Show when="signed-out">
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "radial-gradient(800px 400px at 20% 0%, rgba(122,162,247,.08), transparent 60%), #050508", color: "#c0caf5" }}>
          <div style={{ width: "min(520px,100%)", background: "#161b2e", border: "1px solid #2a2f4a", borderRadius: 20, padding: 28, boxShadow: "0 24px 60px rgba(0,0,0,.5)" }}>
            <div style={{ fontWeight: 800, letterSpacing: ".14em", fontSize: 12 }}>▞▚ КЛОД БОТ <span style={{ color: "#565f89" }}>· DISPLAY</span></div>
            <h1 style={{ margin: "14px 0 8px", fontSize: 22, fontWeight: 800 }}>Увійдіть, щоб бачити дисплей</h1>
            <p style={{ margin: 0, color: "#8a90b8", lineHeight: 1.6, fontSize: 13 }}>Без входу екран недоступний. Вхід у цьому ж вікні — без переходу на інший сайт.</p>
            <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
              <SignInButton mode="modal"><button type="button" style={{ padding: "10px 18px", borderRadius: 999, border: "1px solid #7aa2f7", background: "#7aa2f7", color: "#050508", fontWeight: 800, cursor: "pointer" }}>Увійти</button></SignInButton>
              <SignUpButton mode="modal"><button type="button" style={{ padding: "10px 18px", borderRadius: 999, border: "1px solid #2a2f4a", background: "transparent", color: "#c0caf5", fontWeight: 700, cursor: "pointer" }}>Реєстрація</button></SignUpButton>
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
        <SignInButton mode="modal"><button type="button" style={{ padding: "6px 12px", borderRadius: 999, border: "1px solid #2a2f4a", background: "#7aa2f7", color: "#050508", fontWeight: 800, fontSize: 12, cursor: "pointer" }}>Увійти</button></SignInButton>
        <SignUpButton mode="modal"><button type="button" style={{ padding: "6px 12px", borderRadius: 999, border: "1px solid #2a2f4a", background: "transparent", color: "#c0caf5", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>Реєстрація</button></SignUpButton>
      </Show>
      <Show when="signed-in"><UserButton afterSignOutUrl="/" /></Show>
    </span>
  );
}
