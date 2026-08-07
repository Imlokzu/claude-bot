import { useEffect, useRef } from "react";
import "./dossier.css";

// The panel that opens once the camera has settled on a picked slab.
// Same HUD language as ToolDossier — the carving on the stone is the
// primary read, this is the legible backup for when the stone drifts or
// the angle isn't kind to the etched text.
export default function PillarDossier({ pillar, index, onClose }) {
  const panelRef = useRef(null);
  const closeRef = useRef(null);
  // Focus lifecycle: move focus to the close button when a dossier opens,
  // then restore the exact previous connected element on close.
  useEffect(() => {
    if (!pillar) return;
    const previous = document.activeElement;
    const panel = panelRef.current;

    closeRef.current?.focus();

    return () => {
      const current = document.activeElement;
      const shouldRestore =
        !current || !current.isConnected || current === document.body || panel?.contains(current);
      if (!shouldRestore) return;

      const previousTarget = previous !== document.body && previous?.isConnected ? previous : null;
      const fallback =
        document.querySelector('main[id="fusion"]') || document.querySelector("canvas");
      (previousTarget || fallback)?.focus?.();
    };
  }, [pillar]);

  // Keep Escape working even when focus is inside the panel.
  useEffect(() => {
    if (!pillar) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pillar]);

  if (!pillar) return null;

  return (
    <aside
      ref={panelRef}
      role="dialog"
      aria-labelledby="pillar-dossier-title"
      tabIndex={-1}
      className="dossier"
      style={{ "--tool": "#7fd0ff" }}
    >
      <header className="dossier__head">
        <span className="dossier__addr">
          {String(index + 1).padStart(2, "0")} / stone
        </span>
        <button
          ref={closeRef}
          className="dossier__close"
          onClick={onClose}
          aria-label="Close stone dossier"
        >
          [×] close
        </button>
      </header>

      <h3 id="pillar-dossier-title" className="dossier__title">
        {pillar.title}
      </h3>
      <p className="dossier__tagline">{pillar.copy}</p>

      <footer className="dossier__foot">
        <span>position</span>
        <span className="dossier__ok">● holding</span>
      </footer>
    </aside>
  );
}
