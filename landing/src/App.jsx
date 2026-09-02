import { useEffect, useRef, useState } from "react";
import { useProgress } from "@react-three/drei";
import CRTScene from "./three/CRTScene";
import SpaceScene from "./three/SpaceScene";
import { preloadBodies } from "./three/ToolPlanets";
import Nav from "./components/Nav";
import Loader from "./components/Loader";
import "./crab/crab.css";

// A cap on how much longer we'll hold the intro past its own animation
// once it's finished, waiting on assets. Long enough for a slow
// connection to actually catch up, short enough that a stuck loader
// never reads as a broken page.
const MAX_EXTRA_WAIT_MS = 3000;

// The CRT cold-boot runs the better part of a minute before the site
// appears. `?skipIntro` jumps straight to it — the boot log has had the
// same escape hatch for a while (see useBootLog), but that one can't help
// here because this intro is the 3D CRT, not the DOM one, and there's no
// way to get to the site to check anything without sitting through it.
const SKIP_INTRO =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("skipIntro");

export default function App() {
  const [booted, setBooted] = useState(SKIP_INTRO);
  const [leaving, setLeaving] = useState(SKIP_INTRO);
  const [introGone, setIntroGone] = useState(SKIP_INTRO);
  // the CRT's own dive animation has finished, but the site behind it
  // might not be ready yet — see the effect below
  const [diveArrived, setDiveArrived] = useState(false);
  const revealed = useRef(SKIP_INTRO);
  // useProgress reads three.js's shared DefaultLoadingManager, which every
  // loader in the app reports to — it works here with no Canvas of its
  // own, so this is the *same* progress the later Loader readout shows,
  // just watched a beat earlier to gate the intro itself.
  const { active: loadingActive, progress } = useProgress();

  // The boot sequence is several seconds of screen time we'd otherwise
  // waste — spend it fetching the asteroid meshes the later acts need.
  // This kicks off immediately on mount, well before the intro's own
  // animation finishes.
  useEffect(() => {
    preloadBodies();
  }, []);

  function reveal() {
    if (revealed.current) return;
    revealed.current = true;
    // the camera has just flown through the CRT glass — mount the site
    // underneath first, then dissolve the intro over it, so the two frames
    // blend instead of cutting to black between them.
    setBooted(true);
    requestAnimationFrame(() => setLeaving(true));
    setTimeout(() => setIntroGone(true), 700);
  }

  // The whole point of the intro is to mask the load, not just to play
  // before it — so don't cut to the site the instant the dive animation
  // ends if assets are still landing. Hold one more beat (capped) so the
  // handoff into the fusion act doesn't land on an empty frame.
  useEffect(() => {
    if (!diveArrived) return;
    if (!loadingActive || progress >= 100) {
      reveal();
      return;
    }
    const id = setTimeout(reveal, MAX_EXTRA_WAIT_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diveArrived, loadingActive, progress]);

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
          {/* Same effect, a third of the channel split. On a phone the
              viewport is both smaller and held closer, so a ±1.4px
              offset that reads as a subtle old-camera fringe on desktop
              eats a much bigger share of a small glyph's actual strokes
              — every readout (floating labels, carved stone, HUD text)
              on the page runs through this filter, so it was quietly
              softening all of them at once. See the mobile media query
              in index.css. */}
          <filter id="crt-chromab-mobile" colorInterpolationFilters="sRGB">
            <feColorMatrix
              in="SourceGraphic"
              type="matrix"
              values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
              result="r"
            />
            <feOffset in="r" dx="-0.45" dy="0" result="r2" />
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
            <feOffset in="b" dx="0.45" dy="0" result="b2" />
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
            <CRTScene onDone={() => setDiveArrived(true)} />
          </div>
        )}

        {/* Unconditional, unlike the rest of the site: this is the same
            progress readout whether it's covered by the still-diving CRT
            intro or standing on its own after — the loading it reports
            has been running since the very first frame either way. */}
        <Loader />

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
