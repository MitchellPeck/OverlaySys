import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// The packaged Electron main process runs tsc output under plain Node, and
// @overlaysys/core ships as raw TypeScript (its `main` is src/index.ts). A
// value import from it crashes the app on launch ("Unexpected token
// 'export'") — tests can't see that, because vitest compiles TS on the fly.
// So: desktop sources may only `import type` from core.

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [p] : [];
  });
}

describe("desktop main process", () => {
  it("never imports a runtime value from @overlaysys/core", () => {
    const offenders = sources(path.join(__dirname))
      .filter((f) => {
        const text = readFileSync(f, "utf8");
        const imports = text.match(/import\s+(type\s+)?[^;]*?from\s+["']@overlaysys\/core[^"']*["']/g) ?? [];
        return imports.some((i) => !/^import\s+type\b/.test(i));
      })
      .map((f) => path.relative(__dirname, f));
    expect(offenders).toEqual([]);
  });
});
