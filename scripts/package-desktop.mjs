#!/usr/bin/env node
// Build a packaged OverlaySys desktop bundle.
//
// Pipeline:
//   1. Build the operator as a static export (Next.js with NEXT_BUILD_STATIC=1).
//   2. Build the renderer (Vite).
//   3. Compile the Electron main / preload (tsc).
//   4. Stage everything we need at runtime under apps/desktop/build/staged
//      — that becomes the `app/` folder inside the packaged Resources.
//   5. Run electron-builder.
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
      cwd: REPO_ROOT,
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

  // 4. Stage runtime assets.
  await step("stage runtime tree", async () => {
    await fs.rm(STAGED, { recursive: true, force: true });
    await fs.mkdir(STAGED, { recursive: true });

    // Server source (tsx will transform at runtime).
    await copyDir(
      path.join(REPO_ROOT, "server", "src"),
      path.join(STAGED, "server", "src"),
    );
    await fs.copyFile(
      path.join(REPO_ROOT, "server", "package.json"),
      path.join(STAGED, "server", "package.json"),
    );

    // Workspace packages the server imports (TS source).
    for (const pkg of ["core", "ws-protocol", "template-engine"]) {
      await copyDir(
        path.join(REPO_ROOT, "packages", pkg, "src"),
        path.join(STAGED, "packages", pkg, "src"),
      );
      await fs.copyFile(
        path.join(REPO_ROOT, "packages", pkg, "package.json"),
        path.join(STAGED, "packages", pkg, "package.json"),
      );
    }

    // Lyric-listener daemon.
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
      try {
        await copyDir(src, dst);
      } catch {
        // Fixtures dir may not exist for every kind; skip silently.
      }
    }

    // Workspace metadata so pnpm install resolves the workspace
    // dependencies inside the staged tree.
    await fs.copyFile(
      path.join(REPO_ROOT, "pnpm-workspace.yaml"),
      path.join(STAGED, "pnpm-workspace.yaml"),
    );
    await fs.copyFile(
      path.join(REPO_ROOT, "package.json"),
      path.join(STAGED, "package.json"),
    );
    if (await exists(path.join(REPO_ROOT, ".npmrc"))) {
      await fs.copyFile(
        path.join(REPO_ROOT, ".npmrc"),
        path.join(STAGED, ".npmrc"),
      );
    }
  });

  // 5. electron-builder.
  // Note: the staged tree references workspace packages by symlink. For a
  // shippable bundle, we'd typically run `pnpm install --prod --shamefully-hoist`
  // INSIDE the staged tree to materialize node_modules with all
  // dependencies resolved. That's a TODO — for now electron-builder will
  // include the staged tree as-is and the developer can iterate from the
  // unpacked output before turning on installer codepaths.
  await step("electron-builder", async () => {
    await run("pnpm", ["--filter", "@overlaysys/desktop", "exec", "electron-builder"]);
  });

  process.stdout.write("\n✓ Packaged. See apps/desktop/build/release/\n");
}

async function exists(p) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
