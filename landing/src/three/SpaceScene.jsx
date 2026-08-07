import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, ScrollControls, Scroll, useScroll, Stars } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette, Noise, Autofocus } from "@react-three/postprocessing";
import * as THREE from "three";
import { ACTS, COLORS, PILLARS, SCROLL_PAGES, TOOLS } from "../config";
import StoneField from "./StoneField";
import ToolPlanets, { TOOLS_Y, planetOrbit } from "./ToolPlanets";
import Pillars, { PILLARS_Y, PILLARS_SPAN, pillarPosition, pillarNormal } from "./Pillars";
import Overlays from "../components/Overlays";
import ToolDossier from "../components/ToolDossier";
import PillarDossier from "../components/PillarDossier";
import { Trail } from "./TrailEffect";

const PRICING_Y = PILLARS_Y - 16;

// maps a scroll offset onto 0..1 within one act's range
function actProgress(offset, [from, to]) {
  return THREE.MathUtils.clamp((offset - from) / (to - from), 0, 1);
}

// Owns the camera for the whole page: it descends through the acts as you
// scroll, and detours to a planet when one is selected.
function Rig({ fusionRef, toolsRef, pillarsRef, selected, selectedPillar, boundsRef, onRawScroll }) {
  const scroll = useScroll();
  const look = useRef(new THREE.Vector3(0, 0, 0));

  useEffect(() => {
    const navigate = (e) => {
      const p = THREE.MathUtils.clamp(e.detail?.position ?? 0, 0, 1);
      const max = scroll.el.scrollHeight - scroll.el.clientHeight;
      // Jump directly; ScrollControls supplies the only camera damping.
      scroll.el.scrollTop = max * p;
    };
    window.addEventListener("landing:navigate", navigate);
    // Continuous scroll: the wheel/trackpad owns the position and the
    // camera eases toward it. Make sure no stale snap rules are left on
    // the scroll container from a previous render/HMR cycle.
    scroll.el.style.scrollSnapType = "";
    return () => {
      window.removeEventListener("landing:navigate", navigate);
      scroll.el.style.scrollSnapType = "";
    };
  }, [scroll]);

  useFrame((state, dt) => {
    const offset = THREE.MathUtils.clamp(scroll.offset, 0, 1);
    const max = Math.max(1, scroll.el.scrollHeight - scroll.el.clientHeight);
    const rawOffset = THREE.MathUtils.clamp(scroll.el.scrollTop / max, 0, 1);
    fusionRef.current = actProgress(offset, ACTS.fusion);
    toolsRef.current = actProgress(offset, ACTS.tools);
    pillarsRef.current = actProgress(offset, ACTS.pillars);
    onRawScroll(rawOffset);

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
    const toPillars = THREE.MathUtils.smoothstep(offset, ACTS.tools[1], ACTS.pillars[0]);
    const toPricing = THREE.MathUtils.smoothstep(offset, ACTS.pillars[1], ACTS.pricing[0]);
    let y = THREE.MathUtils.lerp(0.2, TOOLS_Y, toTools);
    // the pillars act isn't a stop but a descent: the camera travels the
    // full run of slabs across its scroll range, meeting each in turn
    const pillarTop = PILLARS_Y + PILLARS_SPAN / 2;
    const pillarBottom = PILLARS_Y - PILLARS_SPAN / 2;
    const throughPillars = THREE.MathUtils.lerp(
      pillarTop,
      pillarBottom,
      pillarsRef.current
    );
    y = THREE.MathUtils.lerp(y, throughPillars, toPillars);
    y = THREE.MathUtils.lerp(y, PRICING_Y, toPricing);

    let z = THREE.MathUtils.lerp(fitZ * 1.03, fitZ, fusionRef.current);
    z = THREE.MathUtils.lerp(z, 19, toTools);
    // far enough that a whole slab fits its side of frame as you pass it
    z = THREE.MathUtils.lerp(z, 12.2, toPillars);
    z = THREE.MathUtils.lerp(z, 20, toPricing);

    let x = 0;
    // during the pillars descent the heading sits at the top of frame, so
    // aim lower there and let the slabs own the bottom two thirds
    let lookAt = new THREE.Vector3(0, y - 0.3 - toPillars * 1.9, 0);

    // detour: fly to the selected body and hold there. It stays a portrait
    // — far enough that the whole silhouette reads, offset to the side the
    // dossier isn't on so the panel never covers it.
    const active = selected && TOOLS.find((t) => t.id === selected);
    const activePillarIdx = selectedPillar ? PILLARS.findIndex((p) => p.key === selectedPillar) : -1;
    if (active) {
      const [px, py, pz] = planetOrbit(TOOLS.indexOf(active), TOOLS.length);
      const narrow = cam.aspect < 1.1; // panel docks to the bottom instead
      x = px + (narrow ? 0 : 3.1);
      y = py + (narrow ? 1.5 : 0.35);
      z = pz + 8.2;
      lookAt = new THREE.Vector3(px, py, pz);
    } else if (activePillarIdx >= 0) {
      // stand in front of the slab's own face, not a fixed world spot —
      // alternating slabs turn opposite ways
      const [px, py, pz] = pillarPosition(activePillarIdx, PILLARS.length);
      const [nx, , nz] = pillarNormal(activePillarIdx, PILLARS.length);
      const narrow = cam.aspect < 1.1;
      const dist = 6.4;
      x = px + nx * dist + (narrow ? 0 : 1.3);
      y = py + 0.35;
      z = pz + nz * dist;
      lookAt = new THREE.Vector3(px, py, pz);
    }

    // The scroll-driven path stays close to the damped offset so the
    // user feels in control; a selected body or slab eases in gently
    // rather than snapping, then keeps a slow living drift.
    const ease = active || activePillarIdx >= 0 ? 1 - Math.pow(0.12, dt) : 1 - Math.pow(0.05, dt);
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
  const pillarsRef = useRef(0);
  const boundsRef = useRef({ halfW: 4, halfH: 2.6 });
  const [selected, setSelected] = useState(null);
  const [selectedPillar, setSelectedPillar] = useState(null);
  const [rawOffset, setRawOffset] = useState(0);

  const handleBounds = useCallback((b) => {
    boundsRef.current = b;
  }, []);

  const pickTool = useCallback((id) => {
    setSelectedPillar(null);
    setSelected(id);
  }, []);
  const pickPillar = useCallback((key) => {
    setSelected(null);
    setSelectedPillar((cur) => (cur === key ? null : key));
  }, []);
  const closePillar = useCallback(() => setSelectedPillar(null), []);

  // leaving the tools act closes any open tool dossier.
  // a picked stone stays open while the user is still in the pillars act,
  // but if they scroll materially past it we give camera authority back
  // to the scroll track instead of leaving it pinned indefinitely.
  useEffect(() => {
    if (selected && (rawOffset < ACTS.tools[0] - 0.06 || rawOffset > ACTS.tools[1] + 0.1)) {
      setSelected(null);
    }
  }, [rawOffset, selected]);

  useEffect(() => {
    if (
      selectedPillar &&
      (rawOffset < ACTS.pillars[0] - 0.08 || rawOffset > ACTS.pillars[1] + 0.1)
    ) {
      setSelectedPillar(null);
    }
  }, [rawOffset, selectedPillar]);

  useEffect(() => {
    if (!selected) return;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

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

        {/* damping is a time-constant on how fast the rig's offset catches
            up to the real scrollTop — higher reads as smoother/heavier,
            lower as snappier/twitchier. 0.1 keeps small deltas visible and
            tied closely to the user's wheel/trackpad, with no snap stages. */}
        <ScrollControls
          pages={SCROLL_PAGES}
          damping={0.1}
        >
          <Rig
            fusionRef={fusionRef}
            toolsRef={toolsRef}
            pillarsRef={pillarsRef}
            boundsRef={boundsRef}
            selected={selected}
            selectedPillar={selectedPillar}
            onRawScroll={setRawOffset}
          />
          <Suspense fallback={null}>
            <StoneField progressRef={fusionRef} onBounds={handleBounds} />
            <ToolPlanets selected={selected} onSelect={pickTool} visibleRef={toolsRef} />
            <Pillars visibleRef={pillarsRef} selected={selectedPillar} onSelect={pickPillar} />
            <Environment preset="city" environmentIntensity={0.4} />
          </Suspense>

          <Scroll html style={{ width: "100%" }}>
            {/* the act's copy steps back while a dossier is open, so the
                body being inspected owns the frame */}
            <div
              style={{
                transition: "opacity 0.35s ease",
                opacity: selected || selectedPillar ? 0.12 : 1,
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
      <PillarDossier
        pillar={PILLARS.find((p) => p.key === selectedPillar)}
        index={PILLARS.findIndex((p) => p.key === selectedPillar)}
        onClose={closePillar}
      />
    </>
  );
}
