import Pricing from "./Pricing";
import "./overlays.css";

// Four 100vh blocks stacked down the scroll track. With SCROLL_PAGES=4
// that puts block N at offset (N-1)/3, which is exactly where the camera
// rig parks for each act — see ACTS in config.
export default function Overlays() {
  return (
    <div className="ov">
      {/* ── block 1 · the fusion ──────────────────────── */}
      <section className="ov__screen ov__screen--hero">
        <h1 className="ov__title glow-text">
          ONE MIND.
          <br />
          THIRTEEN MODELS.
        </h1>
        <p className="ov__sub">every frontier model, fused into a single core</p>
      </section>

      {/* ── block 2 · the tools ───────────────────────── */}
      <section className="ov__screen ov__screen--tools">
        <div className="ov__stack">
          <span className="ov__kicker">
            <span className="chrome__slash">//</span> 02 · The system
          </span>
          <h2 className="ov__title ov__title--sm glow-text">EVERYTHING IT REACHES</h2>
          <p className="ov__sub">
            eight live MCP servers, each riding a real asteroid — point at one
          </p>
        </div>
      </section>

      {/* ── block 3 · pricing ─────────────────────────── */}
      <Pricing />

      {/* ── block 4 · tail, lets the last act settle ──── */}
      <section className="ov__screen ov__screen--tail">
        <div className="ov__stack">
          <span className="ov__kicker">
            <span className="chrome__slash">//</span> Wave Lab
          </span>
          <p className="ov__sub">built in the open · claude bot mk·i · 2026</p>
        </div>
      </section>
    </div>
  );
}
