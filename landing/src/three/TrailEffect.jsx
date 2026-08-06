import { forwardRef, useMemo } from "react";
import { Effect } from "postprocessing";
import * as THREE from "three";

// postprocessing ships no motion-blur pass, so this is the classic
// accumulation trick: keep a copy of the previous frame and blend it under
// the current one. Anything moving leaves a short streak behind it —
// meteorites drifting, the camera diving between acts — which is the part
// of motion blur that actually reads on screen.
//
// `damp` is how much of the old frame survives: 0 disables the effect,
// ~0.85 is a long smear. Kept low here; a trail you notice is too strong.
const fragment = /* glsl */ `
  uniform sampler2D tPrev;
  uniform float damp;

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec4 prev = texture2D(tPrev, uv);
    // only let the trail brighten, never darken — otherwise the whole
    // frame smears into mud on static shots
    vec4 kept = max(prev * damp, inputColor);
    outputColor = kept;
  }
`;

class TrailImpl extends Effect {
  constructor({ damp = 0.72 } = {}) {
    const rt = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType,
    });
    super("Trail", fragment, {
      uniforms: new Map([
        ["tPrev", new THREE.Uniform(rt.texture)],
        ["damp", new THREE.Uniform(damp)],
      ]),
    });
    this.rt = rt;
    this.ready = false;
  }

  setSize(width, height) {
    this.rt.setSize(width, height);
    this.ready = false; // the target was reallocated; re-init before copying
  }

  update(renderer, inputBuffer) {
    if (!inputBuffer) return;
    // stash this frame so the next one can blend it back in
    if (!this.ready) {
      renderer.initRenderTarget(this.rt);
      this.ready = true;
    }
    renderer.copyTextureToTexture(inputBuffer.texture, this.rt.texture);
  }

  dispose() {
    this.rt.dispose();
    super.dispose();
  }
}

export const Trail = forwardRef(({ damp = 0.72 }, ref) => {
  const effect = useMemo(() => new TrailImpl({ damp }), [damp]);
  return <primitive ref={ref} object={effect} dispose={null} />;
});
Trail.displayName = "Trail";
