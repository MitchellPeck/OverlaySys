import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Use a relative base for the production build so the bundle works
// equally well served from `/renderer/` (packaged Electron) or any
// other prefix. Dev server still operates from `/`.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === "build" ? "./" : "/",
  server: {
    port: 3001,
    host: true,
    // The server serves assets and live-folder files; templates reference
    // both by relative URL, so the dev renderer forwards them.
    proxy: { "/assets": "http://localhost:4000", "/media-folders": "http://localhost:4000" },
  },
}));
