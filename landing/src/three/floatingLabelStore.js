// Shared handoff between the two halves of the picked-object read-out.
//
// The copy has to render as real DOM, outside both the WebGL canvas and
// the `.tv-grade` filter, or every lens effect on the page smears it (see
// FloatingLabel.jsx). But the *anchor* only exists inside the scene — it's
// a world-space point that has to be projected with the live camera every
// frame. Those two can't be the same component: a react-dom portal opened
// from inside <Canvas> is reconciled by R3F, which throws on the first
// <span> it sees.
//
// So the scene side (FloatingLabel) publishes what to show here and writes
// screen coordinates straight onto the DOM node, and the layer outside the
// canvas (FloatingLabelLayer) owns the node itself.

let current = null;
const subs = new Set();

export function subscribe(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function getLabel() {
  return current;
}

export function showLabel(label) {
  current = label;
  subs.forEach((fn) => fn(current));
}

// Clearing is keyed: while switching from one object to another, the
// outgoing component's cleanup can run after the incoming one has already
// published, and an unkeyed clear would wipe the new label instantly.
export function hideLabel(key) {
  if (!current || current.key !== key) return;
  current = null;
  subs.forEach((fn) => fn(current));
}

// The live DOM node, so the scene side can set its transform per frame
// without pushing React state 60 times a second.
export const labelNode = { current: null };
