export function TranscriptScreen({ heard, speaking, isStreaming }) {
  return (
    <div className="screen-content">
      <div className="card-title">Розмова</div>
      <div className="transcript-messages">
        {heard && (
          <div className="message user">
            <div className="message-label">Ви</div>
            {heard}
          </div>
        )}
        {speaking && (
          <div className="message bot">
            <div className="message-label">Клод</div>
            {speaking}
            {isStreaming && <span className="streaming-cursor" />}
          </div>
        )}
        {!heard && !speaking && (
          <div style={{ color: "var(--text-muted)", textAlign: "center", marginTop: 40 }}>
            Тут з'являтиметься текст розмови
          </div>
        )}
      </div>
    </div>
  );
}
