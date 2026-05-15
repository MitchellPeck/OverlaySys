import { build } from "esbuild";
import { mkdir, rm, writeFile, cp } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await rm("release", { recursive: true, force: true });

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

// ── Distributable folder ───────────────────────────────────────────────
//
// `release/` is a self-contained copy of the module ready to drop into
// Companion's developer modules path on ANY machine, no pnpm install
// required. Companion reads:
//   - companion/manifest.json (entrypoint, api version, etc.)
//   - dist/index.js (the bundled module — already self-contained)
//   - node_modules/@companion-module/base/package.json (api version check)
//
// The real @companion-module/base SDK is provided by Companion at
// runtime over IPC; we only need to satisfy the file lookup for the
// version check. Mirror the version from manifest.json's apiVersion
// so the two can't drift.
const RELEASE = "release";
await mkdir(`${RELEASE}/companion`, { recursive: true });
await mkdir(`${RELEASE}/dist`, { recursive: true });
await mkdir(`${RELEASE}/node_modules/@companion-module/base`, {
  recursive: true,
});
await cp("companion/manifest.json", `${RELEASE}/companion/manifest.json`);
await cp("dist/index.js", `${RELEASE}/dist/index.js`);
await cp("dist/index.js.map", `${RELEASE}/dist/index.js.map`);
await cp("package.json", `${RELEASE}/package.json`);

// Stub @companion-module/base package.json — version matches
// companion/manifest.json's apiVersion. When you bump the SDK in the
// manifest, bump this version too.
const stub = {
  name: "@companion-module/base",
  version: "1.14.1",
  type: "commonjs",
  main: "dist/index.js",
};
await writeFile(
  `${RELEASE}/node_modules/@companion-module/base/package.json`,
  JSON.stringify(stub, null, 2) + "\n",
);

console.log(`companion-module: packed self-contained ${RELEASE}/`);
