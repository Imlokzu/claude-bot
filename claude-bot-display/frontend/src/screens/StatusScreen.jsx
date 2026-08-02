export function StatusScreen({ state }) {
  return (
    <div className="screen-content">
      <div className="card-title">Система</div>
      <div className="card">
        <div className="indicator-row">
          <span className="indicator-label">Батарея</span>
          <span className="indicator-value" style={{ color: "var(--accent-2)" }}>
            {state.battery ?? "--"}%
          </span>
        </div>
        <div className="indicator-row">
          <span className="indicator-label">Живлення</span>
          <span className="indicator-value" style={{ color: state.charging ? "var(--warning)" : "var(--text)" }}>
            {state.charging ? "Заряджається" : "Від батареї"}
          </span>
        </div>
        <div className="indicator-row">
          <span className="indicator-label">Wi-Fi</span>
          <span className="indicator-value" style={{ color: "var(--accent)" }}>
            {state.wifi_connected ? state.wifi_ssid || "Підключено" : "Немає зв'язку"}
          </span>
        </div>
        <div className="indicator-row">
          <span className="indicator-label">Сервер</span>
          <span className="indicator-value" style={{ color: state.server_online ? "var(--success)" : "var(--danger)" }}>
            {state.server_online ? "Онлайн" : "Офлайн"}
          </span>
        </div>
      </div>

      <div className="card-title" style={{ marginTop: 16 }}>Модель</div>
      <div className="card">
        <div className="indicator-row">
          <span className="indicator-value" style={{ color: "var(--accent-3)" }}>
            {state.current_model || "--"}
          </span>
        </div>
      </div>

      {(state.temperature_c != null || state.cpu_percent != null) && (
        <>
          <div className="card-title" style={{ marginTop: 16 }}>Сенсори</div>
          <div className="card">
            {state.temperature_c != null && (
              <div className="indicator-row">
                <span className="indicator-label">Температура</span>
                <span className="indicator-value">{state.temperature_c}°C</span>
              </div>
            )}
            {state.cpu_percent != null && (
              <div className="indicator-row">
                <span className="indicator-label">CPU</span>
                <span className="indicator-value">{state.cpu_percent}%</span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
