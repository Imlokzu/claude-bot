import { useMemo, useRef, useState } from "react";
import { useFrame, useLoader } from "@react-three/fiber";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import * as THREE from "three";
import { TOOLS } from "../config";
import { createToolTexture } from "./toolTexture";
import FloatingLabel from "./FloatingLabel";

// Real asteroid shape models from NASA's public-domain 3D archive — these
// are the actual scientific meshes flown missions produced (radar shape
// models and OSIRIS-REx altimetry), not spheres pretending to be rocks.
// Each tool gets a real body, and the site names it.
// Six distinct shapes, reused across eight tools. Bennu's mesh is 2.4 MB on
// its own — five times the others — and at this scale you cannot tell it
// apart from Mithra, so it isn't worth the download.
const BODIES = [
  { file: "/models/asteroids/kleopatra.stl", designation: "216 Kleopatra" },
  { file: "/models/asteroids/toutatis.stl", designation: "4179 Toutatis" },
  { file: "/models/asteroids/golevka.stl", designation: "6489 Golevka" },
  { file: "/models/asteroids/geographos.stl", designation: "1620 Geographos" },
  { file: "/models/asteroids/mithra.stl", designation: "4486 Mithra" },
  { file: "/models/asteroids/hw1.stl", designation: "8567 1996 HW1" },
];

// Warm the cache while the CRT is still booting, so stepping into the
// tools act doesn't land on an empty starfield.
export function preloadBodies() {
  const loader = new STLLoader();
  BODIES.forEach((b) => loader.load(b.file, () => {}));
}

function seeded(i) {
  const x = Math.sin(i * 45.233) * 43758.5453;
  return x - Math.floor(x);
}

export const TOOLS_Y = -16;
export const ORBIT = { rx: 6.6, ry: 2.7, rz: 2.4, phase: 0.35 };

export function planetOrbit(i, total) {
  const a = (i / total) * Math.PI * 2 + ORBIT.phase;
  return [
    Math.cos(a) * ORBIT.rx,
    TOOLS_Y + Math.sin(a) * ORBIT.ry,
    Math.sin(a * 1.7) * ORBIT.rz - 0.6,
  ];
}

// STL ships raw triangles with no UVs and an arbitrary scale/origin —
// normalise to a unit body and give it planar UVs so the surface material
// has something to sample.
function prepBody(raw, target) {
  const geo = raw.clone();
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  bb.getSize(size);
  bb.getCenter(center);
  geo.translate(-center.x, -center.y, -center.z);
  const s = target / Math.max(size.x, size.y, size.z);
  geo.scale(s, s, s);
  geo.computeVertexNormals();

  const pos = geo.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    // spherical projection — wraps the rock texture without visible seams
    const v = new THREE.Vector3().fromBufferAttribute(pos, i).normalize();
    uv[i * 2] = 0.5 + Math.atan2(v.z, v.x) / (2 * Math.PI);
    uv[i * 2 + 1] = 0.5 - Math.asin(THREE.MathUtils.clamp(v.y, -1, 1)) / Math.PI;
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return geo;
}

function Body({ tool, body, index, total, selected, onSelect, hovered, onHover, surface, progressRef }) {
  const group = useRef();
  const spinRef = useRef();
  const halo = useRef();
  const labelRef = useRef();
  const labelMat = useRef();
  const base = useMemo(() => planetOrbit(index, total), [index, total]);
  const size = useMemo(() => 1.7 + seeded(index * 3.1) * 0.7, [index]);
  const spin = useMemo(() => 0.05 + seeded(index * 5.5) * 0.08, [index]);
  const phase = useMemo(() => seeded(index * 9.3) * Math.PI * 2, [index]);
  const tilt = useMemo(
    () => [seeded(index * 2.7) * Math.PI, seeded(index * 4.1) * Math.PI, seeded(index * 6.9) * 0.6],
    [index]
  );

  const raw = useLoader(STLLoader, body.file);
  const geo = useMemo(() => prepBody(raw, size), [raw, size]);
  // bodies on the right half of the ring point their leader line inward,
  // so the readout never runs off the edge of frame
  const flip = base[0] > 0;
  const tex = useMemo(
    () => createToolTexture({ ...tool, designation: body.designation, flip }),
    [tool, body, flip]
  );

  const isActive = selected === tool.id;
  const isDimmed = selected && !isActive;
  // right-half bodies point their label inward (see `flip` below); shift
  // the rock the opposite way so text and rock never overlap
  const shiftDir = flip ? 1 : -1;

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const g = group.current;
    if (!g) return;

    const p = progressRef?.current ?? 1;
    // arrive from the side as the act opens, leave the same way as it
    // closes — these bodies are new to the page, not always-there props
    const enter = THREE.MathUtils.smoothstep(p, 0, 0.32);
    const exit = THREE.MathUtils.smoothstep(p, 0.8, 1);
    const travel = base[0] >= 0 ? 1 : -1;
    const slide = (1 - enter) * 7 * travel + exit * 7 * travel;
    const shift = isActive ? shiftDir * 1.5 : 0;

    g.position.set(
      base[0] + slide + shift + Math.sin(t * 0.13 + phase) * 0.3,
      base[1] + Math.cos(t * 0.17 + phase) * 0.24,
      base[2] + Math.sin(t * 0.11 + phase) * 0.32
    );
    // real asteroids tumble on a tilted axis — that's what sells them
    if (spinRef.current) spinRef.current.rotation.y = t * spin;

    const appear = Math.min(enter, 1 - exit);
    const want = (isActive ? 1.2 : hovered === tool.id ? 1.08 : 1) * (0.3 + appear * 0.7);
    g.scale.lerp(new THREE.Vector3(want, want, want), 0.1);

    if (halo.current) {
      const target = (isDimmed ? 0.04 : isActive ? 0.34 : hovered === tool.id ? 0.26 : 0.12) * appear;
      halo.current.material.opacity += (target - halo.current.material.opacity) * 0.08;
      if (spinRef.current) halo.current.rotation.y = spinRef.current.rotation.y;
    }

    // The readout locks on while you point at a body — but not once it's
    // selected: the dossier already carries that copy, and the plate would
    // just hang off the edge of the close-up.
    if (labelMat.current) {
      const want = !selected && hovered === tool.id ? 1 : 0;
      labelMat.current.opacity += (want - labelMat.current.opacity) * 0.16;
      if (labelRef.current) labelRef.current.visible = labelMat.current.opacity > 0.01;
    }
  });

  return (
    <>
    <group ref={group} position={base}>
      <group ref={spinRef} rotation={tilt}>
        <mesh
          geometry={geo}
          onPointerOver={(e) => {
            e.stopPropagation();
            onHover(tool.id);
            document.body.style.cursor = "pointer";
          }}
          onPointerOut={() => {
            onHover(null);
            document.body.style.cursor = "";
          }}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(isActive ? null : tool.id);
          }}
        >
          <meshStandardMaterial
            map={surface.color}
            normalMap={surface.normal}
            roughnessMap={surface.rough}
            normalScale={new THREE.Vector2(0.9, 0.9)}
            color="#b7b0a6"
            roughness={0.92}
            metalness={0.04}
            envMapIntensity={0.5}
          />
        </mesh>
      </group>

      {/* A rim of light hugging the silhouette — the body stays a rock.
          No coloured sphere around it: that's what made these read as toys. */}
      <mesh ref={halo} geometry={geo} scale={1.045} rotation={tilt}>
        <meshBasicMaterial
          color={tool.accent}
          transparent
          opacity={0.14}
          side={THREE.BackSide}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* Survey annotation — only drawn for the body you're pointing at.
          Eight permanent labels turned the frame into a noticeboard; one
          that appears on approach reads like an instrument locking on. */}
      <mesh
        ref={labelRef}
        position={[flip ? -size * 1.5 : size * 1.5, size * 0.75, 0]}
        renderOrder={3}
      >
        <planeGeometry args={[5.6, 2.8]} />
        <meshBasicMaterial
          ref={labelMat}
          map={tex}
          transparent
          opacity={0}
          toneMapped={false}
          depthWrite={false}
          depthTest={false}
        />
      </mesh>
    </group>

    {/* the picked body's copy — floating text beside it in the scene, not
        a docked panel. Anchored off the body's rest position so it holds
        still while the rock itself drifts a little to the side. */}
    <FloatingLabel
      active={isActive}
      title={tool.label}
      copy={tool.tagline}
      accent={tool.accent}
      eyebrow={tool.server}
      position={[base[0] + shiftDir * -2.1, base[1] + 0.5, base[2] + 0.4]}
      width={2.8}
    />
    </>
  );
}

export default function ToolPlanets({ selected, onSelect, visibleRef }) {
  const [hovered, setHovered] = useState(null);
  const groupRef = useRef();

  // one shared rock material set for every body — same ambientCG maps the
  // fusion meteorites use, so the two acts read as the same universe
  const [color, normal, rough] = useLoader(THREE.TextureLoader, [
    "/textures/ice-color.webp",
    "/textures/ice-normal.webp",
    "/textures/ice-roughness.webp",
  ]);
  const surface = useMemo(() => {
    [color, normal, rough].forEach((t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(2, 1);
    });
    color.colorSpace = THREE.SRGBColorSpace;
    return { color, normal, rough };
  }, [color, normal, rough]);

  useFrame(() => {
    const g = groupRef.current;
    if (!g) return;
    g.visible = visibleRef.current > 0.02;
  });

  return (
    <group ref={groupRef}>
      {TOOLS.map((tool, i) => (
        <Body
          key={tool.id}
          tool={tool}
          body={BODIES[i % BODIES.length]}
          index={i}
          total={TOOLS.length}
          progressRef={visibleRef}
          selected={selected}
          onSelect={onSelect}
          hovered={hovered}
          onHover={setHovered}
          surface={surface}
        />
      ))}
    </group>
  );
}
