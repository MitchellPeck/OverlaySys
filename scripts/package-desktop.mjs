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
  //
  // Next.js 14+ errors on `output: "export"` when any route handlers exist
  // (the cloud-only signed-upload endpoint at app/api/assets/signed-upload).
  // Move the api/ folder aside before the build and put it back after, so
  // the static export tree has no route handlers but the source remains.
  await step("operator → static export", async () => {
    const apiDir = path.join(REPO_ROOT, "apps", "operator", "src", "app", "api");
    const apiDirTmp = path.join(
      REPO_ROOT,
      "apps",
      "operator",
      "src",
      "_api-staging",
    );
    const hasApi = await exists(apiDir);
    if (hasApi) {
      await fs.rename(apiDir, apiDirTmp);
    }
    try {
      await run("pnpm", ["--filter", "operator", "exec", "next", "build"], {
        env: { NEXT_BUILD_STATIC: "1" },
      });
    } finally {
      if (hasApi) {
        await fs.rename(apiDirTmp, apiDir);
      }
    }
  });

  // 2. Renderer build.
  await step("renderer → vite build", async () => {
    await run("pnpm", ["--filter", "@overlaysys/renderer", "build"]);
  });

  // 3. Electron main/preload compile.
  await step("desktop → tsc", async () => {
    await run("pnpm", ["--filter", "@overlaysys/desktop", "build"]);
  });

  // 3b. Bake env values from apps/desktop/.env into the dist tree so the
  // packaged app ships with the values inline — no per-machine config
  // needed. Source .env files are NOT included in the build; only the
  // generated JSON is. `.env.local` wins over `.env` (matches the
  // runtime loader's precedence in main.ts).
  await step("desktop → bake env", async () => {
    const desktopRoot = path.join(REPO_ROOT, "apps", "desktop");
    const baked = {};
    for (const fname of [".env", ".env.local"]) {
      const file = path.join(desktopRoot, fname);
      const raw = await fs.readFile(file, "utf8").catch(() => null);
      if (raw === null) continue;
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq < 0) continue;
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        if (key) baked[key] = value;
      }
    }
    const out = path.join(desktopRoot, "dist", "baked-env.json");
    await fs.writeFile(out, JSON.stringify(baked, null, 2), "utf8");
    process.stdout.write(
      `  wrote ${Object.keys(baked).length} key(s) to dist/baked-env.json\n`,
    );
  });

  // 4. Reset the staged dir.
  await step("reset staged dir", async () => {
    await fs.rm(STAGED, { recursive: true, force: true });
    await fs.mkdir(STAGED, { recursive: true });
  });

  // 5. pnpm-deploy server and lyric-listener as self-contained trees with
  // their own prod node_modules. Each gets its own node_modules so Node's
  // ESM resolver can find bare specifiers (e.g. `import { WebSocket } from
  // "ws"`) from the daemon's own directory — NODE_PATH doesn't help with
  // ESM bare imports the way it does for CommonJS.
  await step("pnpm deploy server", async () => {
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

  await step("pnpm deploy lyric-listener", async () => {
    const listenerTarget = path.join(STAGED, "apps", "lyric-listener");
    await run(
      "pnpm",
      [
        "--filter",
        "@overlaysys/lyric-listener",
        "deploy",
        "--prod",
        "--legacy",
        path.relative(REPO_ROOT, listenerTarget),
      ],
    );
  });

  // 6. Stage non-deployed assets (static frontends, fixtures).
  await step("stage runtime assets", async () => {
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

  // 6. electron-builder. Any flags passed to this script (e.g. --win, --mac,
  // --linux, or --x64/--arm64) are forwarded to electron-builder as-is.
  // With no flags, electron-builder targets the host platform.
  const builderArgs = process.argv.slice(2);
  await step(
    `electron-builder${builderArgs.length ? " " + builderArgs.join(" ") : ""}`,
    async () => {
      await run("pnpm", [
        "--filter",
        "@overlaysys/desktop",
        "exec",
        "electron-builder",
        ...builderArgs,
      ]);
    },
  );

  process.stdout.write("\n✓ Packaged. See apps/desktop/build/release/\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
