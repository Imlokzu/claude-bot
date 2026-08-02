import { PixelEyes } from "../components/PixelEyes";

export function FaceScreen({ emotion }) {
  return (
    <div className="screen-content" style={{ justifyContent: "center" }}>
      <PixelEyes emotion={emotion} size={14} gap={3} />
    </div>
  );
}
