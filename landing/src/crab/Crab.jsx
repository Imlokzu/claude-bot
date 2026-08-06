import { useEffect, useRef } from "react";
import { PixelCrab } from "./PixelCrab";

// React wrapper around the vanilla-canvas PixelCrab mascot (ported from
// Virtual Bot's static/crab.js — same animation engine, no changes to logic).
export default function Crab({
  emotion = "idle",
  width = 256,
  height = 150,
  scale,
  static: isStatic = false,
  style,
  className,
  ...opts
}) {
  const canvasRef = useRef(null);
  const crabRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const crab = new PixelCrab(canvasRef.current, null, null, {
      scale,
      ...opts,
    });
    crabRef.current = crab;
    if (isStatic) {
      // A frozen logo still has to be drawn once. Stepping the sprite
      // directly guarantees a painted canvas even where rAF never runs —
      // a background tab, or a reduced-motion setting — instead of
      // depending on the animation loop we're about to shut down.
      crab.destroy();
      for (let i = 0; i < 6; i++) crab._update(1 / 60);
      return () => crab.destroy();
    }
    return () => crab.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    crabRef.current?.setEmotion(emotion);
  }, [emotion]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className={className}
      style={{ imageRendering: "pixelated", ...style }}
    />
  );
}
