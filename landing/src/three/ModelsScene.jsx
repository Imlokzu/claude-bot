import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { Environment, ScrollControls, Scroll } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette, Noise } from "@react-three/postprocessing";
import { COLORS, SCROLL_PAGES } from "../config";
import StoneField from "./StoneField";

function Hero() {
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-end",
        paddingBottom: "14vh",
        pointerEvents: "none",
        textAlign: "center",
      }}
    >
      <div
        className="glow-text big"
        style={{ fontSize: "clamp(40px, 8vw, 92px)", lineHeight: 0.95 }}
      >
        ONE MIND.
        <br />
        THIRTEEN MODELS.
      </div>
      <p
        className="tag"
        style={{ marginTop: 18, color: "var(--ink)", opacity: 0.75 }}
      >
        every frontier model, fused into a single core
      </p>
    </div>
  );
}

// igloo-style HUD readouts — small data labels sitting in the corners of
// the frame once the monolith has fused, the "living interface" texture
// that a flat headline alone can't give.
function FusedHud() {
  const corner = {
    position: "absolute",
    pointerEvents: "none",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  };
  return (
    <div style={{ position: "absolute", top: "78vh", left: 0, width: "100vw", height: "100vh" }}>
      <div style={{ ...corner, top: "4vh", left: "4vw" }}>
        <span className="tag" style={{ color: "var(--accent)" }}>
          ◇ core_status
        </span>
        <span className="hud-link" style={{ borderBottom: "none", paddingBottom: 0 }}>
          fusing···
        </span>
      </div>
      <div style={{ ...corner, top: "4vh", right: "4vw", left: "auto", alignItems: "flex-end" }}>
        <span className="tag" style={{ color: "var(--accent)" }}>
          models_linked
        </span>
        <span className="hud-link" style={{ borderBottom: "none", paddingBottom: 0 }}>
          13 / 13
        </span>
      </div>
      <div style={{ ...corner, bottom: "6vh", left: "4vw", top: "auto" }}>
        <span className="tag">wave_lab · claude_bot</span>
      </div>
    </div>
  );
}

export default function ModelsScene() {
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ position: [0, 0.2, 8.5], fov: 42 }}
      gl={{ antialias: true, alpha: true }}
    >
      <color attach="background" args={[COLORS.bg]} />
      <fog attach="fog" args={[COLORS.bg, 9, 22]} />

      <ambientLight intensity={0.5} />
      <directionalLight position={[3, 5, 4]} intensity={1.2} color="#cfe0ff" />
      <pointLight position={[0, 1, 9]} intensity={1.2} color="#9fc4ff" />
      <pointLight position={[-4, -1, 3]} intensity={1.4} color="#3a5a8f" />
      <pointLight position={[0, 2, -3]} intensity={0.8} color="#7fd0ff" />

      <ScrollControls pages={SCROLL_PAGES} damping={0.4}>
        <Suspense fallback={null}>
          <StoneField />
          <Environment preset="city" environmentIntensity={0.4} />
        </Suspense>
        <Scroll html style={{ width: "100%" }}>
          <Hero />
          <FusedHud />
        </Scroll>
      </ScrollControls>

      <EffectComposer>
        <Bloom mipmapBlur intensity={0.55} luminanceThreshold={0.5} luminanceSmoothing={0.3} />
        <Vignette eskil={false} offset={0.25} darkness={0.85} />
        <Noise opacity={0.04} />
      </EffectComposer>
    </Canvas>
  );
}
