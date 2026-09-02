import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, ScrollControls, Scroll, useScroll, Stars } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette, Noise, Autofocus } from "@react-three/postprocessing";
import * as THREE from "three";
import {
  ACTS,
  COLORS,
  FUSION_HOLD,
  MODELS,
  PILLARS,
  SCROLL_PAGES,
  TOOLS,
  TOOLS_ARRIVE,
} from "../config";
import StoneField, { fusedLayout } from "./StoneField";
import ToolPlanets, { TOOLS_Y, planetOrbit } from "./ToolPlanets";
import Pillars, { PILLARS_Y, PILLARS_SPAN, pillarPosition, pillarNormal } from "./Pillars";
import Overlays from "../components/Overlays";
import ExitButton from "../components/ExitButton";
import FloatingLabelLayer from "./FloatingLabelLayer";
import { Trail } from "./TrailEffect";

const PRICING_Y = PILLARS_Y - 16;

// maps a scroll offset onto 0..1 within one act's range
function actProgress(offset, [from, to]) {
  return THREE.MathUtils.clamp((offset - from) / (to - from), 0, 1);
}

// Owns the camera for the whole page: it descends through the acts as you
// scroll, and detours to a planet when one is selected.
//
// CRITICAL: we drive the camera from the browser's raw scrollTop every frame,
// not from Drei's damped `scroll.offset`. Damping on offset is what made the
// scene lag behind the wheel and then catch up in a skip. Tiny ScrollControls
// damping is only kept so the HTML overlay layer still works; Rig overwrites
// `scroll.offset` so HTML and 3D stay locked to the same raw position.
function Rig({
  fusionRef,
  toolsRef,
  pillarsRef,
  rawOffsetRef,
  selected,
  selectedPillar,
  selectedModel,
  boundsRef,
  onRawScroll,
}) {
  const scroll = useScroll();
  const look = useRef(new THREE.Vector3(0, 0, 0));
  const lookTarget = useRef(new THREE.Vector3(0, 0, 0));
  const modelLayout = useMemo(() => fusedLayout(MODELS.length), []);
  const wasInspecting = useRef(false);
  const closeEase = useRef(0);
  const snapTarget = useRef(null);
  const idleTimer = useRef(null);

  useEffect(() => {
    const navigate = (e) => {
      const p = THREE.MathUtils.clamp(e.detail?.position ?? 0, 0, 1);
      const max = scroll.el.scrollHeight - scroll.el.clientHeight;
      // Direct jump — no smooth scroll animation that fights the wheel.
      scroll.el.scrollTop = max * p;
    };
    window.addEventListener("landing:navigate", navigate);

    // CSS scroll-snap turned out too weak/inconsistent across browsers to
    // reliably catch a hard flick — a JS-driven idle snap is a much
    // stronger, tunable pull. While the wheel is actively moving, this
    // does nothing at all (no fighting the gesture, no added lag). Only
    // once scrolling goes quiet does it check whether the offset landed
    // close enough to one of the five act centers to have clearly been
    // *aiming* for it, and if so, eases the rest of the way there.
    const SNAP_POINTS = [0, 0.25, 0.5, 0.75, 1];
    // How far off-target still counts as "aiming for it". Tightened from
    // 0.09 for the fusion hold's sake: at 0.09 the pull toward block 2
    // started at offset 0.16, which is *inside* the hold — stop scrolling
    // to look at the assembled cluster and the page would quietly drag you
    // off it. The snap now can't reach past 0.19, where the descent starts
    // anyway, so the whole hold is somewhere you're allowed to just stand.
    const SNAP_CATCH = 0.06;
    const IDLE_MS = 110;

    const onScroll = () => {
      snapTarget.current = null;
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => {
        const max = scroll.el.scrollHeight - scroll.el.clientHeight;
        if (max <= 0) return;
        const offset = scroll.el.scrollTop / max;
        let nearest = SNAP_POINTS[0];
        let bestDist = Infinity;
        for (const p of SNAP_POINTS) {
          const d = Math.abs(offset - p);
          if (d < bestDist) {
            bestDist = d;
            nearest = p;
          }
        }
        if (bestDist <= SNAP_CATCH) snapTarget.current = nearest * max;
      }, IDLE_MS);
    };
    scroll.el.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      window.removeEventListener("landing:navigate", navigate);
      scroll.el.removeEventListener("scroll", onScroll);
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [scroll]);

  useFrame((state, dt) => {
    // Drive the idle snap, if one's pending. Setting scrollTop here fires
    // a native "scroll" event too, but that just re-arms the same idle
    // timer harmlessly — it only ever resolves to this same target again.
    if (snapTarget.current !== null) {
      const cur = scroll.el.scrollTop;
      const gap = snapTarget.current - cur;
      if (Math.abs(gap) < 0.5) {
        scroll.el.scrollTop = snapTarget.current;
        snapTarget.current = null;
      } else {
        scroll.el.scrollTop = cur + gap * (1 - Math.pow(0.02, dt));
      }
    }

    const max = Math.max(1, scroll.el.scrollHeight - scroll.el.clientHeight);
    const rawOffset = THREE.MathUtils.clamp(scroll.el.scrollTop / max, 0, 1);
    if (rawOffsetRef) rawOffsetRef.current = rawOffset;

    // Force Drei's damped offset onto the raw scrollbar so overlays and
    // scene never drift apart and never backlog behind the user's input.
    scroll.offset = rawOffset;
    if (scroll.scroll) scroll.scroll.current = rawOffset;
    // Drei's own <Scroll html> only repaints its transform when its
    // internally-damped `state.delta` exceeds a tiny epsilon (see
    // ScrollHtml in node_modules/@react-three/drei/web/ScrollControls.js).
    // That delta is computed from offset's frame-to-frame change through
    // ITS OWN damping step — which we bypass by hard-setting offset above.
    // Once our forced offset stops moving frame-to-frame (i.e. converges
    // exactly, which our snapping does deliberately), drei's delta decays
    // under the epsilon and the DOM overlay freezes at whatever position
    // it last happened to repaint — even though the raw scrollTop (and
    // the 3D camera, which reads it independently) had already moved on.
    // Forcing delta open every frame makes the overlay's position track
    // our offset unconditionally, the same way the camera already does.
    // Guarded on `fixed.firstChild`: ScrollHtml renders its group into
    // that node via ReactDOM.createRoot, which lands a frame or two after
    // this Rig starts running — forcing delta before that ref exists
    // crashes trying to read .style off a null group.
    if (scroll.fixed && scroll.fixed.firstChild) scroll.delta = 1;

    const offset = rawOffset;
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

    // The camera descends: fusion (y≈0) → tools → pillars → pricing.
    //
    // The first leg starts at FUSION_HOLD, not at the end of the fusion
    // itself — the cluster gets a still beat once it's assembled before
    // anything moves — and it runs all the way to TOOLS_ARRIVE, so the
    // descent has six percent of the track to happen over instead of two.
    const toTools = THREE.MathUtils.smoothstep(offset, FUSION_HOLD, TOOLS_ARRIVE);
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
    lookTarget.current.set(0, y - 0.3 - toPillars * 1.9, 0);

    // detour: fly to the selected body and hold there. It stays a portrait
    // — far enough that the whole silhouette reads, offset to the side the
    // dossier isn't on so the panel never covers it.
    const active = selected && TOOLS.find((t) => t.id === selected);
    const activePillarIdx = selectedPillar ? PILLARS.findIndex((p) => p.key === selectedPillar) : -1;
    const activeModelIdx = selectedModel ? MODELS.findIndex((m) => m.id === selectedModel) : -1;
    if (active) {
      const [px, py, pz] = planetOrbit(TOOLS.indexOf(active), TOOLS.length);
      const narrow = cam.aspect < 1.1; // panel docks to the bottom instead
      x = px + (narrow ? 0 : 3.1);
      y = py + (narrow ? 1.5 : 0.35);
      z = pz + 8.2;
      lookTarget.current.set(px, py, pz);
    } else if (activePillarIdx >= 0) {
      // stand in front of the slab's own face, not a fixed world spot —
      // alternating slabs turn opposite ways
      const [px, py, pz] = pillarPosition(activePillarIdx, PILLARS.length);
      const [nx, , nz] = pillarNormal(activePillarIdx, PILLARS.length);
      const narrow = cam.aspect < 1.1;
      const dist = 8.2;
      x = px + nx * dist + (narrow ? 0 : 1.3);
      y = py + 0.35;
      z = pz + nz * dist;
      lookTarget.current.set(px, py, pz);
    } else if (activeModelIdx >= 0) {
      // the honeycomb is dense and small — the label plate needs enough
      // distance to actually fit in frame beside the meteorite, so this
      // pulls back further than the object's own size would suggest
      // a tighter dive than the tools/pillars zoom — the point is that
      // clicking a meteorite pulls you right up to it, not just closer
      const [px, py, pz] = modelLayout[activeModelIdx];
      const narrow = cam.aspect < 1.1;
      const dist = 6.1;
      x = px + (narrow ? 0 : 1.0);
      y = py + 0.25;
      z = pz + dist;
      lookTarget.current.set(px, py, pz);
    }

    // Scroll path: stick to the target almost immediately so wheel input
    // feels like a normal website — no lag, no catch-up skip. Selection
    // detours keep a gentle ease in. Closing one is the tricky third case:
    // snapping straight back to the scroll-driven spot read as the camera
    // teleporting, so it gets its own short eased "zoom out" window before
    // control returns to the instant scroll path.
    const inspecting = !!(active || activePillarIdx >= 0 || activeModelIdx >= 0);
    if (wasInspecting.current && !inspecting) {
      closeEase.current = 1;
    }
    wasInspecting.current = inspecting;

    if (inspecting) {
      const ease = 1 - Math.pow(0.12, dt);
      // An asymptotic lerp never actually reaches its target — it keeps
      // nudging by a shrinking fraction forever. That residual sub-pixel
      // motion, tiny as it is, is exactly what the Trail accumulation
      // pass picks up and keeps smearing frame over frame, so text that's
      // "settled" by eye still reads as blurred. Once the remaining gap
      // is small, stop nudging and snap the rest of the way instead.
      const dx = x - cam.position.x;
      const dy = y - cam.position.y;
      const dz = z - cam.position.z;
      if (dx * dx + dy * dy + dz * dz < 0.0006) {
        cam.position.set(x, y, z);
      } else {
        cam.position.x += dx * ease;
        cam.position.y += dy * ease;
        cam.position.z += dz * ease;
      }
      if (look.current.distanceToSquared(lookTarget.current) < 0.0006) {
        look.current.copy(lookTarget.current);
      } else {
        look.current.lerp(lookTarget.current, ease);
      }
    } else if (closeEase.current > 0.01) {
      // ~0.4s eased hand-off from the close-up back to the scroll position
      closeEase.current = Math.max(0, closeEase.current - dt / 0.42);
      const ease = 1 - Math.pow(0.03, dt);
      cam.position.x += (x - cam.position.x) * ease;
      cam.position.y += (y - cam.position.y) * ease;
      cam.position.z += (z - cam.position.z) * ease;
      look.current.lerp(lookTarget.current, ease);
    } else {
      cam.position.set(x, y, z);
      look.current.copy(lookTarget.current);
    }
    cam.lookAt(look.current);
  });

  return null;
}

export default function SpaceScene() {
  const fusionRef = useRef(0);
  const toolsRef = useRef(0);
  const pillarsRef = useRef(0);
  // the raw, whole-page 0..1 scroll offset, updated every frame — a ref
  // (not the rawOffset state below) so Pillars can read it per-frame
  // without triggering a re-render on every scroll tick
  const rawOffsetRef = useRef(0);
  const boundsRef = useRef({ halfW: 4, halfH: 2.6 });
  const [selected, setSelected] = useState(null);
  const [selectedPillar, setSelectedPillar] = useState(null);
  const [selectedModel, setSelectedModel] = useState(null);
  const [rawOffset, setRawOffset] = useState(0);

  const handleBounds = useCallback((b) => {
    boundsRef.current = b;
  }, []);

  // only one thing is ever "picked" at a time — its floating label is the
  // only UI on screen, so selecting a new object always clears the others
  const pickModel = useCallback((id) => {
    setSelected(null);
    setSelectedPillar(null);
    setSelectedModel((cur) => (cur === id ? null : id));
  }, []);
  const pickTool = useCallback((id) => {
    setSelectedPillar(null);
    setSelectedModel(null);
    setSelected(id);
  }, []);
  const pickPillar = useCallback((key) => {
    setSelected(null);
    setSelectedModel(null);
    setSelectedPillar((cur) => (cur === key ? null : key));
  }, []);

  // leaving the fusion act closes any open meteorite label
  useEffect(() => {
    // the hold counts as part of the act — a meteorite picked while the
    // cluster is sitting assembled must not close under the user
    if (selectedModel && (rawOffset < ACTS.fusion[0] || rawOffset > FUSION_HOLD + 0.015)) {
      setSelectedModel(null);
    }
  }, [rawOffset, selectedModel]);

  // a nav jump (or any deliberate re-navigation) can land past an act's
  // clear-margin in a single frame and skip the scroll-driven checks above
  // entirely — always drop every selection the instant one fires, so a
  // picked object's label can never survive a jump to a different act
  useEffect(() => {
    const clearAll = () => {
      setSelected(null);
      setSelectedPillar(null);
      setSelectedModel(null);
    };
    window.addEventListener("landing:navigate", clearAll);
    return () => window.removeEventListener("landing:navigate", clearAll);
  }, []);

  // leaving the tools act closes any open tool label.
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
    if (!selected && !selectedPillar && !selectedModel) return;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      setSelected(null);
      setSelectedPillar(null);
      setSelectedModel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, selectedPillar, selectedModel]);

  const anySelected = !!(selected || selectedPillar || selectedModel);
  const closeAll = useCallback(() => {
    setSelected(null);
    setSelectedPillar(null);
    setSelectedModel(null);
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

        {/* damping kept near-zero: Rig overwrites offset from raw scrollTop
            every frame so the page scrolls like a normal site with no lag
            backlog or catch-up skip. */}
        <ScrollControls pages={SCROLL_PAGES} damping={0.001}>
          <Rig
            fusionRef={fusionRef}
            toolsRef={toolsRef}
            pillarsRef={pillarsRef}
            rawOffsetRef={rawOffsetRef}
            boundsRef={boundsRef}
            selected={selected}
            selectedPillar={selectedPillar}
            selectedModel={selectedModel}
            onRawScroll={setRawOffset}
          />
          <Suspense fallback={null}>
            <StoneField
              progressRef={fusionRef}
              exitRef={toolsRef}
              onBounds={handleBounds}
              selected={selectedModel}
              onSelect={pickModel}
            />
            <ToolPlanets selected={selected} onSelect={pickTool} visibleRef={toolsRef} />
            <Pillars rawOffsetRef={rawOffsetRef} selected={selectedPillar} onSelect={pickPillar} />
            <Environment preset="city" environmentIntensity={0.4} />
          </Suspense>

          <Scroll html style={{ width: "100%" }}>
            {/* the act's copy steps back while something is picked, so the
                object being inspected — and its floating label — own the
                frame instead of competing with the section headline */}
            <div
              style={{
                transition: "opacity 0.35s ease",
                opacity: anySelected ? 0.12 : 1,
              }}
            >
              <Overlays offset={rawOffset} />
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
      {/* the picked object's copy — deliberately outside the Canvas, so
          none of the post passes above (DoF, bloom, trail) and none of the
          viewport grade can touch the one thing that has to stay readable */}
      <FloatingLabelLayer />
      <ExitButton visible={anySelected} onClose={closeAll} />
    </>
  );
}
