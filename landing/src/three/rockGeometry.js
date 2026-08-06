import * as THREE from "three";

// deterministic pseudo-random from a 3D point (position-keyed, not index-keyed,
// so vertices shared across faces at the same spot displace identically —
// no cracks at the seams).
function hash3(x, y, z) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

// A small faceted "mountain" chunk: an icosahedron with each vertex pushed
// in/out along its own radius by a seeded amount, so every stone reads as a
// unique jagged rock rather than a smooth sphere or a plain box.
export function createRockGeometry(seed = 0, { radius = 0.62, detail = 1, jag = 0.34 } = {}) {
  const geo = new THREE.IcosahedronGeometry(radius, detail);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const nx = Math.round(v.x * 1000) / 1000;
    const ny = Math.round(v.y * 1000) / 1000;
    const nz = Math.round(v.z * 1000) / 1000;
    const n = hash3(nx + seed * 13.1, ny + seed * 7.3, nz + seed * 19.7);
    const disp = 1 + (n - 0.5) * jag;
    v.multiplyScalar(disp);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}
