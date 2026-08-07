import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

// Where the camera should stand to face a selected slab head-on — its
// rest position plus a step back along the face's own normal, not a
// fixed world direction, since alternating slabs face opposite ways.
export function pillarPosition(index, total) {
  return slabPlacement(index, total).position;
}
export function pillarNormal(index, total) {
  const ry = slabPlacement(index, total).rotation[1];
  return [Math.sin(ry), 0, Math.cos(ry)];
}

function Slab({ pillar, index, total, geometry, material, visibleRef, active, onSelect, onHoverStart, onHoverEnd }) {
  const group = useRef();
  const plate = useRef();
  const [hovered, setHovered] = useState(false);
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
    // once picked, the slab keeps drifting — just slower, so it stays a
    // living object in frame rather than freezing mid-air like a prop
    const settle = active ? 0.4 : 1;
    g.position.y = place.position[1] + Math.sin(t * 0.16 + phase) * 0.22 * settle;
    g.rotation.y = place.rotation[1] + Math.sin(t * 0.1 + phase) * 0.05 * settle;
    // the carving shows while the act is on screen, or always once picked
    if (plate.current) {
      const want = active || hovered || visibleRef.current > 0.04 ? 1 : 0;
      plate.current.material.opacity += (want - plate.current.material.opacity) * 0.08;
    }
  });

  const W = 3.5;
  const H = W / 2;

  return (
    <group
      ref={group}
      position={place.position}
      rotation={place.rotation}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(pillar.key);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
        onHoverStart(pillar.key);
      }}
      onPointerOut={() => {
        setHovered(false);
        onHoverEnd(pillar.key);
      }}
    >
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

export default function Pillars({ visibleRef, selected, onSelect }) {
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

  // Central cursor ownership: the parent tracks which slabs are currently
  // hovered and swaps the body cursor exactly once. This avoids duplicate
  // restore races when moving between stones and guarantees cleanup if the
  // whole run becomes invisible while the pointer is stationary.
  const hoveredPillars = useRef(new Set());
  const savedCursor = useRef("");

  const restoreCursor = useCallback(() => {
    if (hoveredPillars.current.size === 0) return;
    document.body.style.cursor = savedCursor.current;
    hoveredPillars.current.clear();
  }, []);

  const onHoverStart = useCallback((key) => {
    if (hoveredPillars.current.has(key)) return;
    if (hoveredPillars.current.size === 0) {
      savedCursor.current = document.body.style.cursor;
      document.body.style.cursor = "pointer";
    }
    hoveredPillars.current.add(key);
  }, []);

  const onHoverEnd = useCallback((key) => {
    hoveredPillars.current.delete(key);
    if (hoveredPillars.current.size === 0) {
      document.body.style.cursor = savedCursor.current;
    }
  }, []);

  useEffect(() => restoreCursor, [restoreCursor]);

  const groupRef = useRef();
  useFrame(() => {
    // once a slab is picked, keep the whole run mounted and visible even
    // if the scroll drifts out of range — closing is a deliberate click,
    // not an accident of losing the act
    const visible = selected || visibleRef.current > 0.01;
    if (groupRef.current) groupRef.current.visible = visible;
    // If the run has just hidden while a slab was hovered, the browser may
    // not emit pointerout. Force the cursor back to its saved state so it
    // cannot stay stuck as a pointer.
    if (!visible) restoreCursor();
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
          active={selected === p.key}
          onSelect={onSelect}
          onHoverStart={onHoverStart}
          onHoverEnd={onHoverEnd}
        />
      ))}
    </group>
  );
}
