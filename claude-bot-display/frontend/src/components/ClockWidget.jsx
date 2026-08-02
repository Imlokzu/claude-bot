export function ClockWidget({ clock, compact }) {
  if (compact) {
    return (
      <div className="widget-compact">
        <span className="widget-compact-value">{clock?.time || "--:--"}</span>
        <span className="widget-compact-label">{clock?.date || ""}</span>
      </div>
    );
  }
  return (
    <div className="widget">
      <div className="widget-value" style={{ fontSize: 20, fontVariantNumeric: "tabular-nums" }}>
        {clock?.time || "--:--:--"}
      </div>
      <div className="widget-label">{clock?.date || "Today"}</div>
    </div>
  );
}
