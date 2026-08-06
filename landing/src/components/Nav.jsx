import { useState } from "react";
import Crab from "../crab/Crab";
import { BRAND } from "../config";
import "./nav.css";

// igloo's chrome isn't a nav bar — it's plain typographic copy anchored to
// the corners of the frame. Same idea here: a masthead block at top-left,
// the mascot + section list at top-right, a status line bottom-left.
const SECTIONS = [
  { label: "Models", to: 0.18 },
  { label: "Tools", to: 0.52 },
  { label: "Pricing", to: 0.85 },
];

export default function Nav({ onNavigate }) {
  const [muted, setMuted] = useState(true);

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
        <div className="chrome__mark">
          {/* rendered at the sprite's native size and scaled down in CSS —
              PixelCrab sizes its body from its `scale` option, so a small
              canvas would draw the crab past its own edges */}
          <Crab emotion="idle" static width={256} height={150} style={{ width: 52, height: "auto" }} />
        </div>
        <nav className="chrome__sections" aria-label="Sections">
          {SECTIONS.map((s) => (
            <button key={s.label} className="chrome__section" onClick={() => onNavigate?.(s.to)}>
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
