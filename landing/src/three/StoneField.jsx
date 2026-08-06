import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useScroll, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { MODELS } from "../config";
import { createGlyphTexture } from "./glyphTexture";
import { createWordmarkTexture } from "./wordmarkTexture";

// Real photogrammetry-scanned rocks (Poly Haven, CC0) — high-poly scan
// meshes with real diffuse/normal/AO-rough-metal maps, not procedural.
const ROCK_MODELS = [
  "/models/rocks/boulder_01/boulder_01.gltf",
  "/models/rocks/rock_09/rock_09.gltf",
  "/models/rocks/namaqualand_boulder_03/namaqualand_boulder_03.gltf",
];
ROCK_MODELS.forEach((p) => useGLTF.preload(p));

// deterministic pseudo-random (no Math.random flicker across re-renders)
function seeded(i) {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

const TARGET_SIZE = 1.05; // every scanned rock is normalized to roughly this footprint
const HEX_SIZE = 0.58; // cell radius — controls how tightly the honeycomb packs

// axial hex coordinates, spiralling out from the centre cell — a proper
// honeycomb packing rather than a grid, and inherently compact/roundish so
// it stays inside the camera frustum instead of running off the sides.
function hexSpiral(count) {
  const dirs = [
    [1, 0],
    [1, -1],
    [0, -1],
    [-1, 0],
    [-1, 1],
    [0, 1],
  ];
  const coords = [[0, 0]];
  let ring = 1;
  while (coords.length < count) {
    let hex = [dirs[4][0] * ring, dirs[4][1] * ring];
    for (let side = 0; side < 6 && coords.length < count; side++) {
      for (let step = 0; step < ring && coords.length < count; step++) {
        coords.push([hex[0], hex[1]]);
        hex = [hex[0] + dirs[side][0], hex[1] + dirs[side][1]];
      }
    }
    ring++;
  }
  return coords.slice(0, count);
}

// most viewports are noticeably wider than tall; stretching the honeycomb
// horizontally means the fit-to-frame camera (which balances width AND
// height separately, see layoutBounds/useFrame below) doesn't have to back
// off for height and leave the sides empty — the whole rectangle fills up.
const WIDTH_STRETCH = 1.55;

// rocks fused into a honeycomb — pointy-top axial hex grid, converted to
// world-space x/y, with a little per-cell jitter and depth banding so it
// still reads as wedged-together stone rather than a perfect lattice.
function fusedLayout(count) {
  const cells = hexSpiral(count);
  const raw = cells.map(([q, r]) => [
    HEX_SIZE * Math.sqrt(3) * (q + r / 2) * WIDTH_STRETCH,
    HEX_SIZE * 1.5 * r,
  ]);
  // an incomplete outer ring (13 doesn't fill a full hex ring) skews the
  // spiral's own centroid off to one side — recentre on the actual
  // bounding box so the cluster sits dead-centre on screen
  const xs = raw.map((p) => p[0]);
  const ys = raw.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  return raw.map(([x, y], i) => {
    const jitterX = (seeded(i * 4.7) - 0.5) * 0.1;
    const jitterY = (seeded(i * 6.3) - 0.5) * 0.08;
    const [q, r] = cells[i];
    const z = (q + r) % 2 === 0 ? 0.14 : -0.14;
    return [x - cx + jitterX, y - cy + jitterY, z];
  });
}

// half-width/half-height of the honeycomb's own footprint, used to size the
// camera dolly on each axis independently — a wide cluster needs a wide fit,
// not a single circular radius that leaves the sides empty on wide screens.
function layoutBounds(positions) {
  let halfW = 0;
  let halfH = 0;
  for (const [x, y] of positions) {
    halfW = Math.max(halfW, Math.abs(x));
    halfH = Math.max(halfH, Math.abs(y));
  }
  const pad = TARGET_SIZE * 0.85;
  return { halfW: halfW + pad, halfH: halfH + pad };
}

// where each stone starts — tumbling in a tight, close band right in front
// of the camera so they're clearly visible (big, in-focus) on the very
// first screen, before any scrolling happens
function scatterStart(i) {
  const a = seeded(i) * Math.PI * 2;
  const r = 2.6 + seeded(i * 7.7) * 1.8;
  const x = Math.cos(a) * r;
  const y = (seeded(i * 2.3) - 0.5) * 3.4;
  const z = -0.6 - seeded(i * 5.1) * 1.8;
  return [x, y, z];
}

// normalize a scanned mesh's geometry so its longest bounding-box axis
// becomes TARGET_SIZE, and re-center it on its own bounds — scans come in
// wildly different native scales (centimetres vs metres).
function useNormalizedRock(path) {
  const { scene } = useGLTF(path);
  return useMemo(() => {
    let mesh = null;
    scene.traverse((o) => {
      if (o.isMesh && !mesh) mesh = o;
    });
    const geo = mesh.geometry.clone();
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const size = new THREE.Vector3();
    bb.getSize(size);
    const center = new THREE.Vector3();
    bb.getCenter(center);
    const scale = TARGET_SIZE / Math.max(size.x, size.y, size.z);
    geo.translate(-center.x, -bb.min.y, -center.z); // sit on its own base
    geo.scale(scale, scale, scale);
    return { geometry: geo, material: mesh.material };
  }, [scene]);
}

function Stone({ model, index, total, fusedPos, rock, progressRef }) {
  const group = useRef();
  const start = useMemo(() => scatterStart(index), [index]);
  const rotStart = useMemo(
    () => [seeded(index * 9.1) * Math.PI * 2, seeded(index * 4.4) * Math.PI * 2, seeded(index * 1.7) * Math.PI * 2],
    [index]
  );
  const rotFinal = useMemo(() => (seeded(index * 6.1) - 0.5) * 0.5, [index]);
  // subtle per-rock variety only — earlier ranges compounded (proportions ×
  // finalScale) into some stones reading almost 2x bigger than others
  const proportions = useMemo(
    () => [0.94 + seeded(index * 3.3) * 0.14, 0.94 + seeded(index * 8.8) * 0.14, 0.94 + seeded(index * 1.2) * 0.14],
    [index]
  );
  const finalScale = 0.92 + seeded(index * 2.1) * 0.2;

  const tex = useMemo(() => createGlyphTexture(model), [model]);
  const glyphMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        toneMapped: false,
        depthWrite: false,
      }),
    [tex]
  );

  const delay = (index / total) * 0.25;

  useFrame(() => {
    const raw = progressRef.current;
    const local = THREE.MathUtils.clamp((raw - delay) / (1 - delay), 0, 1);
    const t = THREE.MathUtils.smoothstep(local, 0, 1);
    const g = group.current;
    if (!g) return;
    g.position.set(
      THREE.MathUtils.lerp(start[0], fusedPos[0], t),
      THREE.MathUtils.lerp(start[1], fusedPos[1], t),
      THREE.MathUtils.lerp(start[2], fusedPos[2], t)
    );
    g.rotation.set(
      THREE.MathUtils.lerp(rotStart[0], 0, t),
      THREE.MathUtils.lerp(rotStart[1], 0, t),
      THREE.MathUtils.lerp(rotStart[2], rotFinal, t)
    );
    const s = THREE.MathUtils.lerp(finalScale * 0.85, finalScale, t);
    g.scale.setScalar(s);
    glyphMat.opacity = THREE.MathUtils.smoothstep(t, 0.5, 1);
  });

  return (
    <group ref={group}>
      <mesh geometry={rock.geometry} material={rock.material} scale={proportions} />
      <mesh position={[0, TARGET_SIZE * 0.5, TARGET_SIZE * 0.78]} material={glyphMat}>
        <planeGeometry args={[0.8, 0.8]} />
      </mesh>
    </group>
  );
}

function Wordmark({ progressRef, halfH }) {
  const ref = useRef();
  const baseY = -halfH - 0.7;
  const { texture, aspect } = useMemo(
    () => createWordmarkTexture("CLAUDE BOT", { size: 108, sub: "future has begun" }),
    []
  );
  const mat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 0,
        toneMapped: false,
        depthWrite: false,
      }),
    [texture]
  );

  useFrame(() => {
    const t = THREE.MathUtils.smoothstep(progressRef.current, 0.84, 1);
    mat.opacity = t;
    if (ref.current) {
      ref.current.position.y = baseY + (1 - t) * 0.3;
      ref.current.scale.setScalar(0.9 + t * 0.1);
    }
  });

  const w = 3.4;
  const h = w / aspect;
  return (
    <mesh ref={ref} position={[0, baseY, 0.4]} material={mat}>
      <planeGeometry args={[w, h]} />
    </mesh>
  );
}

export default function StoneField() {
  const scroll = useScroll();
  const progressRef = useRef(0);
  const layout = useMemo(() => fusedLayout(MODELS.length), []);
  const { halfW, halfH } = useMemo(() => layoutBounds(layout), [layout]);

  const rockA = useNormalizedRock(ROCK_MODELS[0]);
  const rockB = useNormalizedRock(ROCK_MODELS[1]);
  const rockC = useNormalizedRock(ROCK_MODELS[2]);
  const rocks = [rockA, rockB, rockC];

  useEffect(() => {
    const navigate = (event) => {
      const position = THREE.MathUtils.clamp(event.detail?.position ?? 0, 0, 1);
      const maximum = scroll.el.scrollHeight - scroll.el.clientHeight;
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      scroll.el.scrollTo({
        top: maximum * position,
        behavior: reduceMotion ? "auto" : "smooth",
      });
    };

    window.addEventListener("landing:navigate", navigate);
    return () => window.removeEventListener("landing:navigate", navigate);
  }, [scroll]);

  useFrame((state) => {
    // Use the complete normalized scroll range so the three index destinations
    // remain distinct: Origin is scattered, Fusion is in progress, and Core
    // reaches the final locked arrangement.
    progressRef.current = THREE.MathUtils.clamp(scroll.offset, 0, 1);

    // fit-to-frame: width and height are fit independently against the
    // honeycomb's own (stretched, non-circular) footprint, so a wide
    // cluster actually uses the width of a wide viewport instead of being
    // held back by the vertical fit and leaving the sides empty
    const cam = state.camera;
    const vFov = THREE.MathUtils.degToRad(cam.fov);
    const aspect = Math.max(cam.aspect, 0.55); // clamp so tall phones don't zoom out forever
    const distV = halfH / Math.tan(vFov / 2);
    const distH = halfW / (Math.tan(vFov / 2) * aspect);
    // Keep a small safety margin around the true layout bounds so the
    // already-centred cluster is not visibly cropped, while still sitting
    // close to the viewport edges.
    const fitZ = Math.max(distV, distH) * 1.06;
    const targetZ = THREE.MathUtils.lerp(fitZ * 1.03, fitZ, progressRef.current);
    cam.position.z += (targetZ - cam.position.z) * 0.06;
    cam.position.y += (0.2 - cam.position.y) * 0.06;
    cam.lookAt(0, -0.1, 0);
  });

  return (
    <group>
      {MODELS.map((model, i) => (
        <Stone
          key={model.id}
          model={model}
          index={i}
          total={MODELS.length}
          fusedPos={layout[i]}
          rock={rocks[i % rocks.length]}
          progressRef={progressRef}
        />
      ))}
      <Wordmark progressRef={progressRef} halfH={halfH} />
    </group>
  );
}
