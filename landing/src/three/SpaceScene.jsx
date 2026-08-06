import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, ScrollControls, Scroll, useScroll, Stars } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette, Noise, Autofocus } from "@react-three/postprocessing";
import * as THREE from "three";
import { ACTS, COLORS, SCROLL_PAGES, TOOLS } from "../config";
import StoneField from "./StoneField";
import ToolPlanets, { TOOLS_Y, planetOrbit } from "./ToolPlanets";
import Overlays from "../components/Overlays";
import ToolDossier from "../components/ToolDossier";
import { Trail } from "./TrailEffect";

const PRICING_Y = TOOLS_Y * 2;

// maps a scroll offset onto 0..1 within one act's range
function actProgress(offset, [from, to]) {
  return THREE.MathUtils.clamp((offset - from) / (to - from), 0, 1);
}

// Owns the camera for the whole page: it descends through the acts as you
// scroll, and detours to a planet when one is selected.
function Rig({ fusionRef, toolsRef, selected, boundsRef, onScroll }) {
  const scroll = useScroll();
  const look = useRef(new THREE.Vector3(0, 0, 0));

  useEffect(() => {
    const navigate = (e) => {
      const p = THREE.MathUtils.clamp(e.detail?.position ?? 0, 0, 1);
      const max = scroll.el.scrollHeight - scroll.el.clientHeight;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      scroll.el.scrollTo({ top: max * p, behavior: reduce ? "auto" : "smooth" });
    };
    window.addEventListener("landing:navigate", navigate);
    return () => window.removeEventListener("landing:navigate", navigate);
  }, [scroll]);

  useFrame((state, dt) => {
    const offset = THREE.MathUtils.clamp(scroll.offset, 0, 1);
    fusionRef.current = actProgress(offset, ACTS.fusion);
    toolsRef.current = actProgress(offset, ACTS.tools);
    onScroll(offset);

    const cam = state.camera;
    const { halfW, halfH } = boundsRef.current;

    // distance that frames the fusion cluster edge-to-edge
    const vFov = THREE.MathUtils.degToRad(cam.fov);
    const aspect = Math.max(cam.aspect, 0.55);
    const distV = halfH / Math.tan(vFov / 2);
    const distH = halfW / (Math.tan(vFov / 2) * aspect);
    const fitZ = Math.max(distV, distH) * 1.06;

    // the camera descends: fusion (y≈0) → tools → pricing
    const toTools = THREE.MathUtils.smoothstep(offset, ACTS.fusion[1], ACTS.tools[0]);
    const toPricing = THREE.MathUtils.smoothstep(offset, ACTS.tools[1], ACTS.pricing[0]);
    let y = THREE.MathUtils.lerp(0.2, TOOLS_Y, toTools);
    y = THREE.MathUtils.lerp(y, PRICING_Y, toPricing);

    let z = THREE.MathUtils.lerp(fitZ * 1.03, fitZ, fusionRef.current);
    z = THREE.MathUtils.lerp(z, 19, toTools);
    z = THREE.MathUtils.lerp(z, 20, toPricing);

    let x = 0;
    let lookAt = new THREE.Vector3(0, y - 0.3, 0);

    // detour: fly to the selected body and hold there. It stays a portrait
    // — far enough that the whole silhouette reads, offset to the side the
    // dossier isn't on so the panel never covers it.
    const active = selected && TOOLS.find((t) => t.id === selected);
    if (active) {
      const [px, py, pz] = planetOrbit(TOOLS.indexOf(active), TOOLS.length);
      const narrow = cam.aspect < 1.1; // panel docks to the bottom instead
      x = px + (narrow ? 0 : 3.1);
      y = py + (narrow ? 1.5 : 0.35);
      z = pz + 8.2;
      lookAt = new THREE.Vector3(px, py, pz);
    }

    const ease = active ? 1 - Math.pow(0.006, dt) : 1 - Math.pow(0.05, dt);
    cam.position.x += (x - cam.position.x) * ease;
    cam.position.y += (y - cam.position.y) * ease;
    cam.position.z += (z - cam.position.z) * ease;
    look.current.lerp(lookAt, ease);
    cam.lookAt(look.current);
  });

  return null;
}

export default function SpaceScene() {
  const fusionRef = useRef(0);
  const toolsRef = useRef(0);
  const boundsRef = useRef({ halfW: 4, halfH: 2.6 });
  const [selected, setSelected] = useState(null);
  const [offset, setOffset] = useState(0);

  const handleBounds = useCallback((b) => {
    boundsRef.current = b;
  }, []);

  // leaving the tools act closes any open dossier
  useEffect(() => {
    if (selected && (offset < ACTS.tools[0] - 0.06 || offset > ACTS.tools[1] + 0.1)) {
      setSelected(null);
    }
  }, [offset, selected]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && setSelected(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <Canvas
        dpr={[1, 2]}
        camera={{ position: [0, 0.2, 11], fov: 42 }}
        gl={{ antialias: true, alpha: true }}
      >
        <color attach="background" args={[COLORS.bg]} />
        <fog attach="fog" args={[COLORS.bg, 14, 34]} />

        <ambientLight intensity={0.5} />
        <directionalLight position={[3, 5, 4]} intensity={1.2} color="#cfe0ff" />
        <pointLight position={[0, 1, 9]} intensity={1.2} color="#9fc4ff" />
        <pointLight position={[-4, -1, 3]} intensity={1.4} color="#3a5a8f" />
        <pointLight position={[0, TOOLS_Y + 2, 6]} intensity={1.6} color="#7fd0ff" />

        {/* deep space backdrop — the thing that makes the rocks read as
            meteorites rather than props on a black card */}
        <Stars radius={70} depth={45} count={2600} factor={3.4} saturation={0} fade speed={0.4} />

        <ScrollControls pages={SCROLL_PAGES} damping={0.4}>
          <Rig
            fusionRef={fusionRef}
            toolsRef={toolsRef}
            boundsRef={boundsRef}
            selected={selected}
            onScroll={setOffset}
          />
          <Suspense fallback={null}>
            <StoneField progressRef={fusionRef} onBounds={handleBounds} />
            <ToolPlanets selected={selected} onSelect={setSelected} visibleRef={toolsRef} />
            <Environment preset="city" environmentIntensity={0.4} />
          </Suspense>

          <Scroll html style={{ width: "100%" }}>
            {/* the act's copy steps back while a dossier is open, so the
                body being inspected owns the frame */}
            <div
              style={{
                transition: "opacity 0.35s ease",
                opacity: selected ? 0.12 : 1,
              }}
            >
              <Overlays />
            </div>
          </Scroll>
        </ScrollControls>

        <EffectComposer>
          {/* Depth of field is what actually sells "shot on a lens" — the
              reference leans on it hard. Autofocus tracks whatever the
              camera is pointed at, so it stays sharp through every act
              while the far field melts away. */}
          <Autofocus
            smoothTime={0.35}
            focusRange={0.006}
            bokehScale={3}
            resolutionScale={0.85}
          />
          <Bloom mipmapBlur intensity={0.6} luminanceThreshold={0.5} luminanceSmoothing={0.3} />
          {/* short accumulation trail — drifting bodies and camera moves
              leave a streak, which is the readable half of motion blur */}
          <Trail damp={0.62} />
          <Vignette eskil={false} offset={0.25} darkness={0.85} />
          <Noise opacity={0.04} />
        </EffectComposer>
      </Canvas>

      <ToolDossier tool={TOOLS.find((t) => t.id === selected)} onClose={() => setSelected(null)} />
    </>
  );
}
