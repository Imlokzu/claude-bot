import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { hideLabel, labelNode, showLabel } from "./floatingLabelStore";

// The read-out shown when a meteorite / asteroid / slab is picked.
//
// It used to be a canvas texture on a billboarded plane inside the scene,
// which meant every "shot on a lens" effect the site runs for the *objects*
// also ran over the copy: the Autofocus depth-of-field pass, the bloom, the
// Trail accumulation smear, and the whole-viewport chromatic-aberration
// grade — plus the texture itself being resampled at whatever scale the
// plane happened to land on screen. Stacked up, that made the description
// unreadable, which is the one thing this element exists to do.
//
// It's real DOM now, living outside the canvas entirely (see
// FloatingLabelLayer). This half stays in the scene and does the one job
// that needs to be here: projecting the world-space anchor to screen space
// with the live camera every frame, so the copy still floats beside the
// object and travels with it.
//
// `width` is the old world-unit plate width, kept as the API and mapped to
// a pixel measure so the three call sites keep their relative sizing.
const PAD = 16;

export default function FloatingLabel({
  active,
  title,
  copy,
  accent = "#7fd0ff",
  eyebrow,
  position,
  width = 3.4,
}) {
  const { camera, size } = useThree();
  const anchor = useMemo(() => new THREE.Vector3(), []);
  const key = `${eyebrow ?? ""}|${title}`;
  const pxWidth = Math.round(width * 118);

  useEffect(() => {
    if (!active) return;
    showLabel({ key, title, copy, accent, eyebrow, pxWidth });
    return () => hideLabel(key);
  }, [active, key, title, copy, accent, eyebrow, pxWidth]);

  useFrame(() => {
    const node = labelNode.current;
    if (!node || !active) return;
    anchor.set(position[0], position[1], position[2]).project(camera);
    // behind the camera — nothing sensible to anchor to
    if (anchor.z > 1) {
      node.style.visibility = "hidden";
      return;
    }
    node.style.visibility = "visible";
    const w = node.offsetWidth || pxWidth;
    const h = node.offsetHeight || 0;
    const x = THREE.MathUtils.clamp(
      (anchor.x * 0.5 + 0.5) * size.width,
      PAD + w / 2,
      Math.max(PAD + w / 2, size.width - PAD - w / 2)
    );
    const y = THREE.MathUtils.clamp(
      (-anchor.y * 0.5 + 0.5) * size.height,
      PAD + h / 2,
      Math.max(PAD + h / 2, size.height - PAD - h / 2)
    );
    // whole pixels: a fractional transform resamples the glyphs, which is
    // exactly the softness this rewrite exists to get rid of
    node.style.transform = `translate3d(${Math.round(x - w / 2)}px, ${Math.round(y - h / 2)}px, 0)`;
  });

  return null;
}
