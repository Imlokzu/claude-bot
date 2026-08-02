export function WeatherWidget({ weather, compact }) {
  if (!weather) return null;
  if (compact) {
    return (
      <div className="widget-compact">
        <span className="widget-compact-value">{Math.round(weather.temp_c)}°C</span>
        <span className="widget-compact-label">{weather.condition}</span>
      </div>
    );
  }
  return (
    <div className="widget">
      <div className="widget-icon">{weather.icon || "🌡️"}</div>
      <div className="widget-value">{Math.round(weather.temp_c)}°C</div>
      <div className="widget-label">{weather.condition}</div>
    </div>
  );
}
