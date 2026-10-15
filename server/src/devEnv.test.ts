import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadDevEnvFiles, parseEnvFile } from "./devEnv";

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "overlaysys-devenv-"));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("parseEnvFile", () => {
  it("parses KEY=VALUE lines, strips quotes, skips comments and blanks", () => {
    const parsed = parseEnvFile(
      [
        "# comment",
        "",
        "A=1",
        'B="two words"',
        "C='single'",
        "  D = spaced  ",
        "not-a-pair",
        "E=has=equals",
      ].join("\n"),
    );
    expect(parsed).toEqual({ A: "1", B: "two words", C: "single", D: "spaced", E: "has=equals" });
  });
});

describe("loadDevEnvFiles", () => {
  it("fills in missing keys from the first file that defines them, never overriding the shell", async () => {
    await fs.writeFile(path.join(dir, ".env.local"), "NEXT_PUBLIC_SUPABASE_URL=https://local\n");
    await fs.writeFile(
      path.join(dir, ".env"),
      "NEXT_PUBLIC_SUPABASE_URL=https://shared\nNEXT_PUBLIC_SUPABASE_ANON_KEY=anon\nPORT=9999\n",
    );
    const env: Record<string, string | undefined> = { PORT: "4000" };
    const applied = loadDevEnvFiles(env, [path.join(dir, ".env.local"), path.join(dir, ".env")]);
    expect(env["NEXT_PUBLIC_SUPABASE_URL"]).toBe("https://local");
    expect(env["NEXT_PUBLIC_SUPABASE_ANON_KEY"]).toBe("anon");
    // Shell wins.
    expect(env["PORT"]).toBe("4000");
    expect(applied.sort()).toEqual(["NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_URL"]);
  });

  it("ignores files that do not exist", () => {
    const env: Record<string, string | undefined> = {};
    expect(loadDevEnvFiles(env, [path.join(dir, "nope.env")])).toEqual([]);
    expect(env).toEqual({});
  });
});
