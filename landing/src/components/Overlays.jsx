import { FUSION_HOLD, TOOLS_ARRIVE } from "../config";
import Pricing from "./Pricing";
import "./overlays.css";

// The overlay blocks scroll continuously with the track, so block 2's
// headline is already halfway up the frame while the fusion is still the
// thing on screen — it landed right across the assembled cluster during
// the hold, which is exactly the beat that's supposed to be uninterrupted.
// Hold it out of the way until the camera actually starts descending.
function toolsCopyOpacity(offset) {
  if (offset <= FUSION_HOLD) return 0;
  if (offset >= TOOLS_ARRIVE) return 1;
  return (offset - FUSION_HOLD) / (TOOLS_ARRIVE - FUSION_HOLD);
}

// Five 100vh blocks stacked down the scroll track. With SCROLL_PAGES=5
// that puts block N at offset (N-1)/4, which is exactly where the camera
// rig parks for each act — see ACTS in config.
//
// data-text on titles feeds the depth-plate ::before so the 3D tilt has
// a second plane behind the glyph.
export default function Overlays({ offset = 0 }) {
  return (
    <div className="ov">
      {/* ── block 1 · the fusion ──────────────────────────────────
          no DOM headline here on purpose — the meteorites converging
          into "CLAUDE BOT / the future is now" (a 3D wordmark, see
          StoneField) carry the introduction now. This block stays as
          a bare 100vh spacer so the scroll grid and camera acts still
          line up with Overlays' five blocks. */}
      <section className="ov__screen ov__screen--hero" />

      {/* ── block 2 · the tools ───────────────────────── */}
      <section className="ov__screen ov__screen--tools">
        <div className="ov__stack" style={{ opacity: toolsCopyOpacity(offset) }}>
          <span className="ov__kicker">
            <span className="chrome__slash">//</span> 02 · The system
          </span>
          <h2 className="ov__title ov__title--sm glow-text" data-text="TOOLS, WITH CONTEXT">
            TOOLS, WITH CONTEXT
          </h2>
          <p className="ov__sub">
            eight live MCP servers, each riding a real asteroid — point at one
          </p>
        </div>
      </section>

      {/* ── block 3 · what it stands for ──────────────── */}
      <section className="ov__screen ov__screen--tools">
        <div className="ov__stack">
          <span className="ov__kicker">
            <span className="chrome__slash">//</span> 03 · The position
          </span>
          <h2 className="ov__title ov__title--sm glow-text" data-text="FIVE THINGS, IN STONE">
            FIVE THINGS, IN STONE
          </h2>
        </div>
      </section>

      {/* ── block 4 · pricing ─────────────────────────── */}
      <Pricing />

      {/* ── block 5 · tail, lets the last act settle ──── */}
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
