import { useRef, useState } from "react";
import Crab from "../crab/Crab";
import { BRAND } from "../config";
import "./nav.css";

// igloo's chrome isn't a nav bar — it's plain typographic copy anchored to
// the corners of the frame. Same idea here: a masthead block at top-left,
// the mascot + section list at top-right, a status line bottom-left.
// Scroll destinations, one per act. These are the block centres the
// overlay grid lands on — see ACTS/SCROLL_PAGES in config; with five
// blocks, block N sits at (N-1)/4.
const SECTIONS = [
  { label: "Models", to: 0.0 },
  { label: "Tools", to: 0.25 },
  { label: "Position", to: 0.5 },
  { label: "Pricing", to: 0.75 },
];

export default function Nav({ onNavigate }) {
  const [muted, setMuted] = useState(true);
  // which section the cursor is on, and how far down the frame that
  // section's own line sits — see the wordmark below
  const [aimed, setAimed] = useState(null);
  const mark = useRef(null);

  // Point at a section and the crab walks over to it: down to that line,
  // and left of the label, so it reads as the mascot standing next to the
  // thing you're about to open — 🦀 // MODELS.
  //
  // Measured off live geometry rather than hard-coded offsets: the row
  // spacing, the crab's size and the list's right inset all change at the
  // mobile breakpoint, so anything precomputed would drift.
  //
  // The measurement uses OFFSET geometry, not getBoundingClientRect. That
  // matters: rects include transforms, and moving the cursor straight from
  // one section to another fires mouseleave→mouseenter within a frame, so
  // the crab is still mid-flight (or mid-return) when the next hover is
  // measured. Reading its transformed rect made the new travel relative to
  // wherever it happened to be at that instant, and since the transform is
  // then applied from its untransformed origin the crab landed somewhere
  // arbitrary — which is why hopping between sections worked only
  // sometimes. offsetTop/offsetLeft are layout positions and ignore
  // transforms entirely, so the same hover always yields the same answer.
  //
  // Both the crab and the buttons resolve their offsets against
  // .chrome__right (the nearest positioned ancestor — .chrome__sections in
  // between is static), so the two are directly comparable.
  const GAP = 14;
  function aim(el) {
    const m = mark.current;
    if (!el || !m) return setAimed(null);
    setAimed({
      x: el.offsetLeft - GAP - (m.offsetLeft + m.offsetWidth),
      y:
        el.offsetTop +
        el.offsetHeight / 2 -
        (m.offsetTop + m.offsetHeight / 2),
    });
  }

  return (
    <div className="chrome">
      {/* top-left: masthead, igloo-style copyright stack */}
      <div className="chrome__masthead">
        <div className="chrome__wordmark">{BRAND.name}</div>
        <div className="chrome__meta">
          <span className="chrome__slash">//</span> Copyright © {BRAND.year}
        </div>
        <div className="chrome__meta chrome__meta--dim">
          {BRAND.owner}, Inc.
          <br />
          All Rights Reserved.
        </div>
      </div>

      {/* top-right: the mascot sits here, with the section list beneath it */}
      <div className="chrome__right">
        <div
          ref={mark}
          className={`chrome__mark ${aimed ? "is-aimed" : ""}`}
          style={aimed ? { transform: `translate(${aimed.x}px, ${aimed.y}px)` } : undefined}
        >
          {/* rendered at the sprite's native size and scaled down in CSS —
              PixelCrab sizes its body from its `scale` option, so a small
              canvas would draw the crab past its own edges */}
          <Crab emotion="idle" static width={256} height={150} style={{ width: 52, height: "auto" }} />
        </div>
        <nav className="chrome__sections" aria-label="Sections">
          {SECTIONS.map((s) => (
            <button
              key={s.label}
              className="chrome__section"
              onClick={() => onNavigate?.(s.to)}
              onMouseEnter={(e) => aim(e.currentTarget)}
              onMouseLeave={() => setAimed(null)}
              onFocus={(e) => aim(e.currentTarget)}
              onBlur={() => setAimed(null)}
            >
              <span className="chrome__slash">//</span> {s.label}
            </button>
          ))}
        </nav>
      </div>

      {/* bottom-left: sound toggle, exactly the igloo affordance */}
      <button className="chrome__sound" onClick={() => setMuted((m) => !m)}>
        {muted ? "◁×" : "◁))"} Sound: {muted ? "Off" : "On"}
      </button>
    </div>
  );
}
