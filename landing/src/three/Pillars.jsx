import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { PILLARS } from "../config";
import { createCarvedTexture } from "./carvedTexture";

export const PILLARS_Y = -32;

// The slabs ride the same scanned boulder the fusion act uses — one rock,
// one universe. Loading it here is free; StoneField already has it cached.
const SLAB_MODEL = "/models/rocks-opt/namaqualand_boulder_03.glb";
const DRACO_PATH = "/draco/gltf/";

function seeded(i) {
  const x = Math.sin(i * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

// How far the run of slabs reaches above and below the act's centre. The
// camera descends through this range as you scroll, so the stelae arrive
// one at a time instead of all being visible at once.
export const PILLARS_SPAN = 17;

// Alternating left/right down that descent, each turned slightly inward so
// its face stays readable as you pass.
function slabPlacement(i, total) {
  const t = i / Math.max(1, total - 1); // 0 → 1, top to bottom
  const side = i % 2 === 0 ? -1 : 1;
  return {
    position: [
      side * (1.85 + seeded(i) * 0.3),
      PILLARS_Y + (0.5 - t) * PILLARS_SPAN,
      -0.6 + seeded(i * 3.7) * 1.2,
    ],
    rotation: [0, side * -0.34, (seeded(i * 5.3) - 0.5) * 0.14],
  };
}

function Slab({ pillar, index, total, geometry, material, visibleRef }) {
  const group = useRef();
  const plate = useRef();
  const place = useMemo(() => slabPlacement(index, total), [index, total]);
  const phase = useMemo(() => seeded(index * 9.1) * Math.PI * 2, [index]);

  const tex = useMemo(
    () =>
      createCarvedTexture({
        title: pillar.title,
        copy: pillar.copy,
        index: String(index + 1).padStart(2, "0"),
        accent: "#7fd0ff",
      }),
    [pillar, index]
  );

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    g.position.y = place.position[1] + Math.sin(t * 0.16 + phase) * 0.22;
    g.rotation.y = place.rotation[1] + Math.sin(t * 0.1 + phase) * 0.05;
    // the carving only shows while this act is on screen
    if (plate.current) {
      const want = visibleRef.current > 0.04 ? 1 : 0;
      plate.current.material.opacity += (want - plate.current.material.opacity) * 0.08;
    }
  });

  const W = 3.5;
  const H = W / 2;

  return (
    <group ref={group} position={place.position} rotation={place.rotation}>
      {/* the stone itself, flattened into a slab */}
      {/* the slab has to out-measure the carving plate below, or the words
          spill off the rock and stop reading as cut into it */}
      <mesh geometry={geometry} material={material} scale={[4.5, 2.5, 0.5]} />
      {/* the carving, floating a hair proud of the face */}
      <mesh ref={plate} position={[0, 0.12, 0.95]}>
        <planeGeometry args={[W, H]} />
        <meshBasicMaterial
          map={tex}
          transparent
          opacity={0}
          toneMapped={false}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

export default function Pillars({ visibleRef }) {
  const { scene } = useGLTF(SLAB_MODEL, DRACO_PATH);
  const { geometry, material } = useMemo(() => {
    let mesh = null;
    scene.traverse((o) => {
      if (o.isMesh && !mesh) mesh = o;
    });
    const geo = mesh.geometry.clone();
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    bb.getSize(size);
    bb.getCenter(center);
    geo.translate(-center.x, -center.y, -center.z);
    const s = 1 / Math.max(size.x, size.y, size.z);
    geo.scale(s, s, s);
    return { geometry: geo, material: mesh.material };
  }, [scene]);

  const groupRef = useRef();
  useFrame(() => {
    if (groupRef.current) groupRef.current.visible = visibleRef.current > 0.01;
  });

  return (
    <group ref={groupRef}>
      {PILLARS.map((p, i) => (
        <Slab
          key={p.key}
          pillar={p}
          index={i}
          total={PILLARS.length}
          geometry={geometry}
          material={material}
          visibleRef={visibleRef}
        />
      ))}
    </group>
  );
}
