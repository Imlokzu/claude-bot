export function CustomScreen({ contentType, content, timerText, alarm }) {
  if (alarm) {
    return (
      <div className="screen-content" style={{ justifyContent: "center" }}>
        <div className="card alarm-active" style={{ textAlign: "center", padding: 24 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>⏰</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "var(--danger)" }}>
            Будильник!
          </div>
          <div style={{ marginTop: 8, color: "var(--text)" }}>{alarm.label}</div>
        </div>
      </div>
    );
  }

  if (contentType === "list") {
    const items = content
      .split("\n")
      .map((line) => line.replace(/^\s*[-•]\s*/, "").trim())
      .filter(Boolean);
    return (
      <div className="screen-content">
        <div className="card-title">Список</div>
        <ul className="custom-list">
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      </div>
    );
  }

  if (contentType === "timer") {
    return (
      <div className="screen-content" style={{ justifyContent: "center" }}>
        <div className="card-title">Таймер</div>
        <div className="timer-display">{timerText || "00:00"}</div>
      </div>
    );
  }

  if (contentType === "qr_code") {
    return (
      <div className="screen-content" style={{ justifyContent: "center", textAlign: "center" }}>
        <div className="card-title">QR-код</div>
        <div
          style={{
            background: "#fff",
            color: "#000",
            padding: 16,
            borderRadius: 12,
            fontFamily: "monospace",
            fontSize: 12,
            wordBreak: "break-all",
          }}
        >
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className="screen-content" style={{ justifyContent: "center", textAlign: "center" }}>
      <div className="card-title">Інформація</div>
      <div style={{ fontSize: 16, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{content}</div>
    </div>
  );
}
