import { useProgress } from "@react-three/drei";
import "./loader.css";

// What fills the gap between the CRT powering through and the space scene
// having its meshes. Without it that's several seconds of black, which
// reads as "broken" rather than "loading".
//
// Styled as one more readout rather than a spinner: same monospace, same
// hairline, so it belongs to the machine that just booted.
export default function Loader() {
  const { progress, active } = useProgress();
  if (!active && progress >= 100) return null;

  return (
    <div className="loader" role="status" aria-live="polite">
      <div className="loader__row">
        <span className="loader__label">
          <span className="chrome__slash">//</span> loading system
        </span>
        <span className="loader__pct">{String(Math.round(progress)).padStart(3, " ")}%</span>
      </div>
      <div className="loader__track">
        <div className="loader__fill" style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}
