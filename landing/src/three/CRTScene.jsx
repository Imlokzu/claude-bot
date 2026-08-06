import { Suspense, useEffect, useMemo, useRef } from "react";
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

// runs the boot sequence, paints the terminal, and — once booted — plays a
// CRT power-off collapse on the screen alone, then signals completion.
function Screen({ term, onPoweredOff }) {
  const boot = useBootLog();
  const bootRef = useRef(boot);
  bootRef.current = boot;
  const grpRef = useRef();
  const off = useRef(0);
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

  useFrame((state, dt) => {
    term.draw({ ...bootRef.current, t: state.clock.elapsedTime });
    const g = grpRef.current;
    if (!g) return;

    if (bootRef.current.phase === "done") {
      off.current = Math.min(1, off.current + dt / 0.45);
    }
    const p = off.current;

    // collapse: squash Y to a bright line, then pinch X to a dot
    let sx = 1;
    let sy = 1;
    if (p > 0) {
      if (p < 0.6) sy = 1 - (p / 0.6) * 0.982;
      else {
        sy = 0.018;
        sx = Math.max(0.0001, 1 - (p - 0.6) / 0.4);
      }
    }
    g.scale.set(sx, sy, 1);

    // over-brighten as it collapses so the line blooms, then fades to black
    const flash = p > 0 ? 1 + Math.min(1, p * 1.6) * 2.4 : 1;
    const fade = p > 0.94 ? Math.max(0, (1 - p) / 0.06) : 1;
    mat.color.setScalar(flash * fade);

    if (p >= 1 && !fired.current) {
      fired.current = true;
      mat.visible = false;
      onPoweredOff?.();
    }
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

function Rig({ onDone }) {
  const term = useMemo(() => createTerminalTexture(), []);
  useEffect(() => () => term.dispose(), [term]);
  return (
    <group rotation={[0, Math.PI, 0]} scale={3.2} position={[0, -0.58, 0]}>
      <Suspense fallback={null}>
        <Model />
      </Suspense>
      <Screen term={term} onPoweredOff={onDone} />
    </group>
  );
}

export default function CRTScene({ onDone }) {
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ position: [0, 0.05, 5.6], fov: 40 }}
      gl={{ antialias: true, alpha: true }}
    >
      <color attach="background" args={["#04060a"]} />
      <fog attach="fog" args={["#04060a", 5, 10]} />

      <ambientLight intensity={0.35} />
      <directionalLight position={[3, 4, 5]} intensity={1.1} color="#cfe0ff" />
      <pointLight position={[0, 0.4, 2.4]} intensity={1.6} distance={5} color="#3bff8a" />
      <pointLight position={[-3, 1, -2]} intensity={1.6} color="#3a5a8f" />

      <Rig onDone={onDone} />
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
