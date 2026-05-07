#!/usr/bin/env node
// Build a packaged OverlaySys desktop bundle.
//
// Pipeline:
//   1. Build the operator as a static export (Next.js with NEXT_BUILD_STATIC=1).
//   2. Build the renderer (Vite).
//   3. Compile the Electron main / preload (tsc).
//   4. `pnpm deploy` the server with prod deps into a self-contained tree.
//      This is the canonical way to extract a workspace package + its
//      transitive prod dependencies into a directory that runs without
//      the surrounding workspace.
//   5. Stage the rest (lyric-listener, static frontends, fixtures) next
//      to the deployed server under apps/desktop/build/staged/.
//   6. Run electron-builder.
//
// Run from the repo root: `pnpm --filter @overlaysys/desktop package`

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..");

const STAGED = path.join(REPO_ROOT, "apps", "desktop", "build", "staged");

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      cwd: opts.cwd ?? REPO_ROOT,
      env: { ...process.env, ...(opts.env ?? {}) },
      shell: false,
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} → exit ${code}`));
    });
    child.on("error", reject);
  });
}

async function step(label, fn) {
  process.stdout.write(`\n══ ${label} ══\n`);
  await fn();
}

async function copyDir(src, dst) {
  await fs.mkdir(dst, { recursive: true });
  await fs.cp(src, dst, { recursive: true });
}

async function exists(p) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  // 1. Operator static export.
  await step("operator → static export", async () => {
    await run("pnpm", ["--filter", "operator", "exec", "next", "build"], {
      env: { NEXT_BUILD_STATIC: "1" },
    });
  });

  // 2. Renderer build.
  await step("renderer → vite build", async () => {
    await run("pnpm", ["--filter", "@overlaysys/renderer", "build"]);
  });

  // 3. Electron main/preload compile.
  await step("desktop → tsc", async () => {
    await run("pnpm", ["--filter", "@overlaysys/desktop", "build"]);
  });

  // 4. Reset the staged dir, then pnpm-deploy the server with prod deps.
  await step("pnpm deploy server", async () => {
    await fs.rm(STAGED, { recursive: true, force: true });
    await fs.mkdir(STAGED, { recursive: true });
    const serverTarget = path.join(STAGED, "server");
    await run(
      "pnpm",
      [
        "--filter",
        "@overlaysys/server",
        "deploy",
        "--prod",
        // pnpm v10+ defaults to "injected workspace deps" mode for deploy;
        // --legacy keeps the older behavior that materializes workspace
        // deps directly, which is what we want here.
        "--legacy",
        // Must use a relative path; absolute paths confuse pnpm deploy
        // about whether the target sits inside the workspace.
        path.relative(REPO_ROOT, serverTarget),
      ],
    );
  });

  // 5. Stage runtime assets next to the deployed server.
  await step("stage runtime assets", async () => {
    // Lyric-listener daemon. It imports `ws`, which the server's
    // node_modules already provides; we set NODE_PATH at spawn time so
    // the listener finds it.
    await copyDir(
      path.join(REPO_ROOT, "apps", "lyric-listener", "src"),
      path.join(STAGED, "apps", "lyric-listener", "src"),
    );
    await fs.copyFile(
      path.join(REPO_ROOT, "apps", "lyric-listener", "package.json"),
      path.join(STAGED, "apps", "lyric-listener", "package.json"),
    );

    // Static frontend builds.
    await copyDir(
      path.join(REPO_ROOT, "apps", "operator", "out"),
      path.join(STAGED, "apps", "operator", "out"),
    );
    await copyDir(
      path.join(REPO_ROOT, "apps", "renderer", "dist"),
      path.join(STAGED, "apps", "renderer", "dist"),
    );

    // Fixtures (the server seeds these into userData on first run).
    for (const kind of ["templates", "shows", "channels", "songs"]) {
      const src = path.join(REPO_ROOT, "data", kind, "fixtures");
      const dst = path.join(STAGED, "data", kind, "fixtures");
      if (await exists(src)) {
        await copyDir(src, dst);
      }
    }
  });

  // 6. electron-builder.
  await step("electron-builder", async () => {
    await run("pnpm", [
      "--filter",
      "@overlaysys/desktop",
      "exec",
      "electron-builder",
    ]);
  });

  process.stdout.write("\n✓ Packaged. See apps/desktop/build/release/\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
