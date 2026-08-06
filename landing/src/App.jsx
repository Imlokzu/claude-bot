import { useEffect, useState } from "react";
import CRTScene from "./three/CRTScene";
import SpaceScene from "./three/SpaceScene";
import { preloadBodies } from "./three/ToolPlanets";
import Nav from "./components/Nav";
import "./crab/crab.css";

export default function App() {
  const [booted, setBooted] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [introGone, setIntroGone] = useState(false);

  // The boot sequence is several seconds of screen time we'd otherwise
  // waste — spend it fetching the asteroid meshes the later acts need.
  useEffect(() => {
    preloadBodies();
  }, []);

  function handleDone() {
    // the camera has just flown through the CRT glass — mount the site
    // underneath first, then dissolve the intro over it, so the two frames
    // blend instead of cutting to black between them.
    setBooted(true);
    requestAnimationFrame(() => setLeaving(true));
    setTimeout(() => setIntroGone(true), 700);
  }

  function handleNavigate(position) {
    window.dispatchEvent(new CustomEvent("landing:navigate", { detail: { position } }));
  }

  return (
    <>
      {/* hidden SVG filter: splits RGB channels for a cheap old-camera
          chromatic-aberration look, applied to the whole viewport below */}
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
        <defs>
          <filter id="crt-chromab" colorInterpolationFilters="sRGB">
            <feColorMatrix
              in="SourceGraphic"
              type="matrix"
              values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
              result="r"
            />
            <feOffset in="r" dx="-1.4" dy="0" result="r2" />
            <feColorMatrix
              in="SourceGraphic"
              type="matrix"
              values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
              result="g"
            />
            <feColorMatrix
              in="SourceGraphic"
              type="matrix"
              values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
              result="b"
            />
            <feOffset in="b" dx="1.4" dy="0" result="b2" />
            <feBlend in="r2" in2="g" mode="screen" result="rg" />
            <feBlend in="rg" in2="b2" mode="screen" />
          </filter>
        </defs>
      </svg>

      <div className="tv-grade">
        {/* atmosphere overlays */}
        <div className="rain">
          {Array.from({ length: 60 }).map((_, i) => (
            <i
              key={i}
              style={{
                left: `${(i * 1.7) % 100}%`,
                animationDuration: `${0.6 + (i % 5) * 0.18}s`,
                animationDelay: `${-(i % 7) * 0.3}s`,
                opacity: 0.25 + (i % 4) * 0.12,
              }}
            />
          ))}
        </div>
        <div className="vignette" />
        <div className="grain" />

        {!introGone && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 100,
              pointerEvents: leaving ? "none" : "auto",
              transition: "opacity 0.55s ease",
              opacity: leaving ? 0 : 1,
            }}
          >
            <CRTScene onDone={handleDone} />
          </div>
        )}

        {booted && (
          <>
            <main
              id="fusion"
              tabIndex={-1}
              aria-label="Claude Bot"
              style={{ position: "fixed", inset: 0 }}
            >
              <SpaceScene />
            </main>
            <Nav onNavigate={handleNavigate} />
          </>
        )}
      </div>

      {/* old-recording overlay — always on top, never affected by the grade filter itself */}
      <div className="tv-overlay">
        <div className="tv-overlay__scan" />
        <div className="tv-overlay__roll" />
        <div className="tv-overlay__vig" />
        <div className="tv-overlay__flicker" />
      </div>
    </>
  );
}
