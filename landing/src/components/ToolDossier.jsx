import "./dossier.css";

// The panel that opens once the camera has flown into a tool planet.
// Deliberately a HUD readout, not a modal card — no rounded box, no
// scrim; the scene stays visible and alive behind it.
export default function ToolDossier({ tool, onClose }) {
  if (!tool) return null;

  return (
    <aside className="dossier" style={{ "--tool": tool.accent }}>
      <header className="dossier__head">
        <span className="dossier__addr">{tool.server}</span>
        <button className="dossier__close" onClick={onClose} aria-label="Close">
          [×] close
        </button>
      </header>

      <h3 className="dossier__title">{tool.label}</h3>
      <p className="dossier__tagline">{tool.tagline}</p>

      <ul className="dossier__caps">
        {tool.caps.map((c) => (
          <li key={c}>
            <span className="dossier__bullet">▸</span>
            {c}
          </li>
        ))}
      </ul>

      <footer className="dossier__foot">
        <span>status</span>
        <span className="dossier__ok">● connected</span>
      </footer>
    </aside>
  );
}
