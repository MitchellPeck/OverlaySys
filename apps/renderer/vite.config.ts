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
  },
}));
