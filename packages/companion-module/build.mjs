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
  // Companion's SDK (and some transitive deps) call require() at runtime.
  // ESM bundles don't have require by default — banner-inject one built
  // from createRequire so calls like require("net") work.
  banner: {
    js: [
      `import { createRequire as __companion_createRequire } from "node:module";`,
      `import { fileURLToPath as __companion_fileURLToPath } from "node:url";`,
      `import __companion_path from "node:path";`,
      `const require = __companion_createRequire(import.meta.url);`,
      `const __filename = __companion_fileURLToPath(import.meta.url);`,
      `const __dirname = __companion_path.dirname(__filename);`,
    ].join("\n"),
  },
});

console.log("companion-module: built dist/index.js");
