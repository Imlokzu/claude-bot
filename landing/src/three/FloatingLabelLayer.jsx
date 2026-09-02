import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { getLabel, labelNode, subscribe } from "./floatingLabelStore";
import "./floatingLabel.css";

// The DOM half of the picked-object read-out. Rendered from *outside* the
// <Canvas> (so react-dom, not R3F, reconciles it) and portalled to
// document.body (so it sits outside `.tv-grade` and its channel-split
// filter). Nothing on the page blurs it; the scene-side FloatingLabel just
// tells it what to say and where to sit.
export default function FloatingLabelLayer() {
  const label = useSyncExternalStore(subscribe, getLabel, getLabel);
  // hold the last content through the fade-out so closing a selection
  // dissolves instead of vanishing mid-frame
  const [shown, setShown] = useState(label);

  useEffect(() => {
    if (label) {
      setShown(label);
      return;
    }
    const id = setTimeout(() => setShown(null), 320);
    return () => clearTimeout(id);
  }, [label]);

  useEffect(() => {
    return () => {
      labelNode.current = null;
    };
  }, []);

  // Cursor light. The plate can't take pointer events (it would swallow the
  // wheel — see floatingLabel.css), so "hovering" it is done by proximity:
  // the pointer's position drives where the light pools, and how far it is
  // from the plate drives how bright everything gets. Reads as a hover,
  // costs nothing, blocks nothing.
  useEffect(() => {
    if (!shown) return undefined;
    let queued = false;
    let last = null;

    const apply = () => {
      queued = false;
      const node = labelNode.current;
      if (!node || !last) return;
      const r = node.getBoundingClientRect();
      node.style.setProperty("--mx", `${last.x - r.left}px`);
      node.style.setProperty("--my", `${last.y - r.top}px`);
      // distance to the plate's box, 0 while inside it
      const dx = Math.max(r.left - last.x, 0, last.x - r.right);
      const dy = Math.max(r.top - last.y, 0, last.y - r.bottom);
      const dist = Math.hypot(dx, dy);
      const FALLOFF = 200;
      node.style.setProperty("--lit", String(Math.max(0, 1 - dist / FALLOFF)));
    };

    const onMove = (e) => {
      last = { x: e.clientX, y: e.clientY };
      if (queued) return;
      queued = true;
      requestAnimationFrame(apply);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [shown]);

  if (!shown) return null;

  return createPortal(
    <div className="fl-layer">
      <div
        ref={(node) => {
          labelNode.current = node;
        }}
        className={`fl ${label ? "is-on" : ""}`}
        style={{ width: shown.pxWidth, "--fl-accent": shown.accent }}
      >
        {shown.eyebrow && <span className="fl__eyebrow">{shown.eyebrow}</span>}
        <h3 className="fl__title">{shown.title}</h3>
        <span className="fl__rule" />
        <p className="fl__copy">{shown.copy}</p>
      </div>
    </div>,
    document.body
  );
}
