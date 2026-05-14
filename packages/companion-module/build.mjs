import { build } from "esbuild";
import { rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: "dist/index.js",
  sourcemap: true,
  minify: false,
  logLevel: "info",
  // ws ships an optional require of the platform-specific buffer helpers
  // (bufferutil, utf-8-validate). esbuild's default behavior treats them
  // as resolvable; mark as external so the bundle works without them.
  external: ["bufferutil", "utf-8-validate"],
});

console.log("companion-module: built dist/index.js");
