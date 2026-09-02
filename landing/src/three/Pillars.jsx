import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { ACTS, PILLARS } from "../config";
import { createCarvedTexture } from "./carvedTexture";
import FloatingLabel from "./FloatingLabel";

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

function Slab({
  pillar,
  index,
  total,
  geometry,
  material,
  rawOffsetRef,
  active,
  onSelect,
  onHoverStart,
  onHoverEnd,
}) {
  const group = useRef();
  const plate = useRef();
  const [hovered, setHovered] = useState(false);
  const place = useMemo(() => slabPlacement(index, total), [index, total]);
  const phase = useMemo(() => seeded(index * 9.1) * Math.PI * 2, [index]);

  const tex = useMemo(
    () =>
      // the stone carries only its word — the sentence lives in the
      // floating label beside it, so the two don't repeat each other
      createCarvedTexture({
        title: pillar.title,
        index: String(index + 1).padStart(2, "0"),
        accent: "#7fd0ff",
      }),
    [pillar, index]
  );

  const side = place.position[0] >= 0 ? 1 : -1;
  // the camera stands in front of the slab's own face (see pillarNormal in
  // SpaceScene's Rig), not looking down world Z — so "beside it" has to be
  // measured in the slab's own right vector, not world X, or the label can
  // end up behind the camera's shoulder instead of in frame
  const ry = place.rotation[1];
  const rightVec = [-Math.cos(ry), Math.sin(ry)];
  const normalVec = [Math.sin(ry), Math.cos(ry)];

  // this slab's own stop along the descent (0..1 within the pillars act)
  // — used to fade it in as the camera approaches and back out as it
  // moves on, instead of the whole run popping in at once. Expressed as
  // a *global* scroll offset (not the act-local 0..1 pillarsRef), because
  // pillarsRef clamps to exactly 0 for the entire rest of the page —
  // every slab's "distance" from 0 briefly collapsed to zero any time
  // the scroll was merely somewhere else entirely, which read as the
  // very first slab being permanently full-size from the fusion act
  // onward, no matter how far away the camera actually was.
  const ownStop = index / Math.max(1, total - 1);
  const [pStart, pEnd] = ACTS.pillars;
  const ownGlobalOffset = pStart + ownStop * (pEnd - pStart);
  const closeWindowGlobal = 0.16 * (pEnd - pStart);
  // a THREE.Object3D's scale defaults to 1, not whatever we want the
  // "not grown in yet" state to be — reading g.scale.x back as the lerp's
  // starting point meant every slab's very first rendered frame was full
  // size (the object3d default) before the ease had a chance to run, so
  // the whole run flashed in at once. Track the actual value ourselves.
  const scaleRef = useRef(0.28);

  useFrame((state, dt) => {
    const g = group.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    // once picked, the slab keeps drifting — just slower, so it stays a
    // living object in frame rather than freezing mid-air like a prop
    const settle = active ? 0.4 : 1;
    g.position.y = place.position[1] + Math.sin(t * 0.16 + phase) * 0.22 * settle;
    g.rotation.y = place.rotation[1] + Math.sin(t * 0.1 + phase) * 0.05 * settle;
    // step aside when picked, so the floating text has clear space and the
    // stone itself reads as still in the scene, not behind a panel — away
    // from the label, along the slab's own right vector
    const stepAway = active ? -side * 0.85 : 0;
    const wantX = place.position[0] + rightVec[0] * stepAway;
    const wantZ = place.position[2] + rightVec[1] * stepAway;
    g.position.x += (wantX - g.position.x) * Math.min(1, dt * 4);
    g.position.z += (wantZ - g.position.z) * Math.min(1, dt * 4);

    // grow in as the camera's own position along the descent nears this
    // slab's stop, shrink back out as it moves past — so the run reads as
    // "always been there, coming into view" rather than empty space that
    // suddenly spawns a slab
    // narrower than the ~0.25 gap between neighbouring stops (for 5
    // slabs), so at most one, maybe two, are ever growing in together —
    // a wider window let every slab in the run count as "close" at once
    // the moment the act opened, which read as the whole set spawning
    // in a single batch instead of arriving one at a time
    const rawOffset = rawOffsetRef?.current ?? 0;
    const closeness = active
      ? 1
      : 1 -
        THREE.MathUtils.clamp(Math.abs(rawOffset - ownGlobalOffset) / closeWindowGlobal, 0, 1);
    const wantScale = THREE.MathUtils.lerp(0.28, 1, THREE.MathUtils.smoothstep(closeness, 0, 1));
    scaleRef.current = THREE.MathUtils.lerp(scaleRef.current, wantScale, Math.min(1, dt * 3));
    g.scale.setScalar(scaleRef.current);

    // the carving shows once this slab has mostly grown in, or always once picked
    if (plate.current) {
      const want = active || hovered || closeness > 0.5 ? 1 : 0;
      plate.current.material.opacity += (want - plate.current.material.opacity) * 0.08;
    }
  });

  const W = 3.5;
  const H = W / 2;

  return (
    <>
    <group
      ref={group}
      position={place.position}
      rotation={place.rotation}
      scale={0.28}
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

    {/* the picked slab's copy — floating beside the stone in space, not a
        docked panel. The carving stays as the decorative read; this is the
        legible one, dim and glowing like an instrument label. */}
    <FloatingLabel
      active={active}
      title={pillar.title}
      copy={pillar.copy}
      accent="#7fd0ff"
      eyebrow={`${String(index + 1).padStart(2, "0")} / stone`}
      position={[
        place.position[0] + rightVec[0] * side * 1.6 + normalVec[0] * 1.3,
        place.position[1] + 0.3,
        place.position[2] + rightVec[1] * side * 1.6 + normalVec[1] * 1.3,
      ]}
      width={2.1}
    />
    </>
  );
}

export default function Pillars({ rawOffsetRef, selected, onSelect }) {
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

  // No group-level visible toggle any more: that used to hide the whole
  // run behind one shared threshold and then pop it all in at once the
  // instant the scroll crossed it. Each Slab now grows in on its own as
  // the camera nears its particular stop (see `closeness` below), and
  // slabs the camera isn't anywhere near sit outside the view frustum by
  // position alone (they're spread down PILLARS_SPAN, far from wherever
  // the camera currently is), so there's no cost to just leaving the
  // group mounted and visible throughout.
  return (
    <group>
      {PILLARS.map((p, i) => (
        <Slab
          key={p.key}
          pillar={p}
          index={i}
          total={PILLARS.length}
          geometry={geometry}
          material={material}
          rawOffsetRef={rawOffsetRef}
          active={selected === p.key}
          onSelect={onSelect}
          onHoverStart={onHoverStart}
          onHoverEnd={onHoverEnd}
        />
      ))}
    </group>
  );
}
