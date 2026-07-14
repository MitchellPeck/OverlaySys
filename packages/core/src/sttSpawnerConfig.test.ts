import { describe, expect, it } from "vitest";
import {
  buildAugmentedPath,
  buildSttCommand,
  DEFAULT_STT_SPAWNER_CONFIG,
  expandHome,
  shellQuote,
  STT_PATH_AUGMENTS,
  SttSpawnerConfigSchema,
} from "./sttSpawnerConfig";

describe("sttSpawnerConfig schema", () => {
  it("parses an empty object using defaults", () => {
    const parsed = SttSpawnerConfigSchema.parse({});
    expect(parsed).toEqual(DEFAULT_STT_SPAWNER_CONFIG);
  });

  it("rejects negative step/length", () => {
    expect(() =>
      SttSpawnerConfigSchema.parse({ stepMs: 0 }),
    ).toThrow();
    expect(() =>
      SttSpawnerConfigSchema.parse({ lengthMs: -10 }),
    ).toThrow();
  });

  it("allows -1 captureDevice (system default) but not lower", () => {
    expect(SttSpawnerConfigSchema.parse({ captureDevice: -1 }).captureDevice).toBe(-1);
    expect(() =>
      SttSpawnerConfigSchema.parse({ captureDevice: -2 }),
    ).toThrow();
  });

  it("silently drops legacy `command` field (migration handled in storage)", () => {
    const parsed = SttSpawnerConfigSchema.parse({
      command: "old-style-command",
    } as Record<string, unknown>);
    expect((parsed as Record<string, unknown>).command).toBeUndefined();
    expect(parsed.customCommand).toBe("");
  });
});

describe("buildSttCommand", () => {
  it("composes whisper-stream from structured fields", () => {
    const cmd = buildSttCommand({
      ...DEFAULT_STT_SPAWNER_CONFIG,
      modelPath: "/abs/path/ggml-base.en.bin",
      stepMs: 500,
      lengthMs: 5000,
      captureDevice: -1,
    });
    expect(cmd).toContain("whisper-stream");
    expect(cmd).toContain("-m '/abs/path/ggml-base.en.bin'");
    expect(cmd).toContain("--step 500");
    expect(cmd).toContain("--length 5000");
    expect(cmd).toContain("-c -1");
  });

  it("returns the customCommand verbatim when set", () => {
    const cmd = buildSttCommand({
      ...DEFAULT_STT_SPAWNER_CONFIG,
      customCommand: "my-custom-stt | tee out.txt",
    });
    expect(cmd).toBe("my-custom-stt | tee out.txt");
  });

  it("falls back to structured fields when customCommand is whitespace-only", () => {
    const cmd = buildSttCommand({
      ...DEFAULT_STT_SPAWNER_CONFIG,
      customCommand: "   \t  ",
    });
    expect(cmd).toContain("whisper-stream");
  });

  it("shell-quotes model paths containing spaces / special chars", () => {
    const cmd = buildSttCommand({
      ...DEFAULT_STT_SPAWNER_CONFIG,
      modelPath: "/path with spaces/model's.bin",
    });
    // The single quote inside the path must be escaped via the standard
    // close-quote / escape / reopen-quote trick.
    expect(cmd).toContain("'/path with spaces/model'\\''s.bin'");
  });
});

describe("shellQuote", () => {
  it("wraps simple strings in single quotes", () => {
    expect(shellQuote("hello")).toBe("'hello'");
  });
  it("escapes embedded single quotes", () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });
});

describe("expandHome", () => {
  it("returns the input unchanged when no leading tilde", () => {
    expect(expandHome("/abs/path")).toBe("/abs/path");
    expect(expandHome("relative/path")).toBe("relative/path");
  });

  it("expands ~/foo when HOME is set", () => {
    const prev = process.env["HOME"];
    process.env["HOME"] = "/tmp/test-home";
    try {
      expect(expandHome("~/foo")).toBe("/tmp/test-home/foo");
      expect(expandHome("~")).toBe("/tmp/test-home");
    } finally {
      if (prev === undefined) delete process.env["HOME"];
      else process.env["HOME"] = prev;
    }
  });
});

describe("buildAugmentedPath", () => {
  it("prepends the Homebrew/STT augments ahead of the existing PATH", () => {
    const result = buildAugmentedPath("/usr/bin:/bin", ":");
    const parts = result.split(":");
    // Every augment appears, and before the original entries.
    for (const dir of STT_PATH_AUGMENTS) {
      expect(parts).toContain(dir);
      expect(parts.indexOf(dir)).toBeLessThan(parts.indexOf("/usr/bin"));
    }
    expect(parts).toContain("/bin");
  });

  it("de-duplicates entries while preserving first-seen order", () => {
    // /opt/homebrew/bin is already an augment; supplying it again in the
    // existing PATH must not produce a duplicate.
    const result = buildAugmentedPath("/opt/homebrew/bin:/usr/bin", ":");
    const parts = result.split(":");
    const count = parts.filter((p) => p === "/opt/homebrew/bin").length;
    expect(count).toBe(1);
  });

  it("tolerates an empty existing PATH", () => {
    const result = buildAugmentedPath("", ":");
    expect(result.split(":")).toEqual([...STT_PATH_AUGMENTS]);
  });

  it("honours the supplied delimiter (Windows ;)", () => {
    const result = buildAugmentedPath("C:\\Windows", ";");
    expect(result.split(";")).toContain("C:\\Windows");
    expect(result.startsWith(STT_PATH_AUGMENTS[0]!)).toBe(true);
  });
});
