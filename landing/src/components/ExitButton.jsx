import "./exitButton.css";

// The one piece of DOM chrome that appears once something is picked —
// everything else about the selection lives in the scene itself (the
// floating label), but "how do I get out of this" still needs a real,
// visible, clickable answer instead of relying on Escape or re-clicking
// the object.
export default function ExitButton({ visible, onClose }) {
  return (
    <button
      className={`hud-btn exit-btn ${visible ? "is-visible" : ""}`}
      onClick={onClose}
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
    >
      [×] exit
    </button>
  );
}
