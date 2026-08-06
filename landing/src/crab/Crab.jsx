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
      // let it settle into its idle pose for a couple of frames, then
      // freeze — a nav logo shouldn't breathe/blink while you're reading
      const t = setTimeout(() => crab.destroy(), 80);
      return () => {
        clearTimeout(t);
        crab.destroy();
      };
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
