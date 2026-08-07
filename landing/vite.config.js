import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    // The 3D stack dwarfs everything else, so split it out: the shell and
    // the CRT intro can paint while three/drei/postprocessing are still
    // arriving, instead of the whole site waiting on one 7 MB chunk.
    rolldownOptions: {
      output: {
        advancedChunks: {
          groups: [
            { name: "three", test: /node_modules\/three\// },
            { name: "r3f", test: /node_modules\/@react-three\// },
            { name: "postfx", test: /node_modules\/postprocessing\// },
            { name: "icons", test: /node_modules\/simple-icons\// },
          ],
        },
      },
    },
    chunkSizeWarningLimit: 900,
  },
});
