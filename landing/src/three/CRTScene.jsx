import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF, Environment } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette, Noise } from "@react-three/postprocessing";
import * as THREE from "three";
import { createTerminalTexture } from "./terminalCanvas";
import { useBootLog } from "./useBootLog";

useGLTF.preload("/models/crt.glb");

// mat17 is the thin dark rim tracing the screen opening — its bounds give
// the exact rectangle to drop our own convex glass into.
const SCREEN = { cx: 0.017, cy: 0.183, z: -0.222, w: 0.58, h: 0.58 };

// runs the boot sequence and paints the terminal. When the log finishes it
// reports "booted" upward — the rig then flies the camera into the glass,
// so the site literally comes out of the machine that booted it.
function Screen({ term, onBooted }) {
  const boot = useBootLog();
  const bootRef = useRef(boot);
  bootRef.current = boot;
  const grpRef = useRef();
  const fired = useRef(false);

  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(SCREEN.w, SCREEN.h, 40, 40);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = (pos.getX(i) / SCREEN.w) * 2;
      const y = (pos.getY(i) / SCREEN.h) * 2;
      const d = Math.min(1, (x * x + y * y) / 1.7);
      pos.setZ(i, -0.022 * (1 - d)); // gentle convex bulge
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
    return g;
  }, []);

  const mat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: term.texture,
        toneMapped: false,
        side: THREE.DoubleSide,
        depthTest: false,
      }),
    [term]
  );

  // Hand off on a state change, not inside the render loop: rAF is paused
  // in a background tab, and watching for "done" from useFrame meant the
  // intro could never complete if you switched away while it booted.
  useEffect(() => {
    if (boot.phase !== "done" || fired.current) return;
    fired.current = true;
    onBooted?.();
  }, [boot.phase, onBooted]);

  useFrame((state) => {
    term.draw({ ...bootRef.current, t: state.clock.elapsedTime });
  });

  return (
    <group ref={grpRef} position={[SCREEN.cx, SCREEN.cy, SCREEN.z]} rotation={[0, Math.PI, 0]}>
      <mesh geometry={geo} material={mat} renderOrder={2} />
    </group>
  );
}

function Model() {
  const { scene } = useGLTF("/models/crt.glb");
  const model = useMemo(() => {
    const root = scene.clone(true);
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = o.receiveShadow = false;
      const m = o.material;
      if (!m) return;
      if (m.name === "mat17") {
        m.color = new THREE.Color("#05080c");
        m.roughness = 0.6;
        return;
      }
      m.roughness = 0.45;
      m.metalness = 0.15;
      m.envMapIntensity = 1.1;
    });
    return root;
  }, [scene]);
  return <primitive object={model} />;
}

// Once the log finishes, dive the camera into the glass: the screen grows
// until it owns the frame, and the site emerges from inside the machine.
const DIVE_MS = 1150;

function DiveCamera({ diving, onArrived }) {
  const startedAt = useRef(0);
  const fired = useRef(false);
  // world position of the screen plane (rig rotation π + scale 3.2 applied)
  const target = useMemo(() => new THREE.Vector3(-SCREEN.cx * 3.2, SCREEN.cy * 3.2 - 0.58, -SCREEN.z * 3.2), []);

  const arrive = () => {
    if (fired.current) return;
    fired.current = true;
    onArrived?.();
  };

  // Backstop: browsers pause rAF in a background tab, so a dive driven only
  // by frame deltas would stall forever if you switch away mid-intro. A
  // wall-clock timer lands the transition regardless.
  useEffect(() => {
    if (!diving) return;
    startedAt.current = performance.now();
    const id = setTimeout(arrive, DIVE_MS + 120);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diving]);

  useFrame((state) => {
    if (!diving || !startedAt.current) return;
    // progress from wall-clock, not accumulated dt, for the same reason
    const t = Math.min(1, (performance.now() - startedAt.current) / DIVE_MS);
    const e = t * t * t; // ease-in: slow pull, then a rush through the glass
    const cam = state.camera;

    cam.position.x = THREE.MathUtils.lerp(0, target.x, e);
    cam.position.y = THREE.MathUtils.lerp(0.05, target.y, e);
    // overshoot past the plane so we end up "inside" the screen
    cam.position.z = THREE.MathUtils.lerp(5.6, target.z - 0.35, e);
    cam.lookAt(target.x, target.y, target.z - 1);

    if (t >= 1) arrive();
  });
  return null;
}

function Rig({ onBooted }) {
  const term = useMemo(() => createTerminalTexture(), []);
  useEffect(() => () => term.dispose(), [term]);
  return (
    <group rotation={[0, Math.PI, 0]} scale={3.2} position={[0, -0.58, 0]}>
      <Suspense fallback={null}>
        <Model />
      </Suspense>
      <Screen term={term} onBooted={onBooted} />
    </group>
  );
}

export default function CRTScene({ onDone }) {
  const [diving, setDiving] = useState(false);
  // stable identity — Screen's hand-off effect depends on this callback
  const handleBooted = useCallback(() => setDiving(true), []);

  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ position: [0, 0.05, 5.6], fov: 40 }}
      gl={{ antialias: true, alpha: true }}
    >
      <color attach="background" args={["#04060a"]} />
      <fog attach="fog" args={["#04060a", 5, 12]} />

      <ambientLight intensity={0.35} />
      <directionalLight position={[3, 4, 5]} intensity={1.1} color="#cfe0ff" />
      <pointLight position={[0, 0.4, 2.4]} intensity={1.6} distance={5} color="#3bff8a" />
      <pointLight position={[-3, 1, -2]} intensity={1.6} color="#3a5a8f" />

      <Rig onBooted={handleBooted} />
      <DiveCamera diving={diving} onArrived={onDone} />
      <Suspense fallback={null}>
        <Environment preset="warehouse" environmentIntensity={0.35} />
      </Suspense>

      <EffectComposer>
        <Bloom mipmapBlur intensity={0.85} luminanceThreshold={0.55} luminanceSmoothing={0.25} />
        <Vignette eskil={false} offset={0.28} darkness={0.9} />
        <Noise opacity={0.045} />
      </EffectComposer>
    </Canvas>
  );
}
