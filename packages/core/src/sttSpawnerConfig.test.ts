import { describe, expect, it } from "vitest";
import {
  buildSttCommand,
  commandUsesBias,
  DEFAULT_STT_SPAWNER_CONFIG,
  expandHome,
  shellQuote,
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

describe("commandUsesBias", () => {
  it("returns true when customCommand references $OVERLAYSYS_BIAS_PROMPT", () => {
    expect(
      commandUsesBias({
        ...DEFAULT_STT_SPAWNER_CONFIG,
        customCommand: `whisper-cli --prompt "$OVERLAYSYS_BIAS_PROMPT" -m foo.bin`,
      }),
    ).toBe(true);
  });

  it("returns true for ${OVERLAYSYS_BIAS_PROMPT...} bash braces", () => {
    expect(
      commandUsesBias({
        ...DEFAULT_STT_SPAWNER_CONFIG,
        customCommand: `wrap "${"${OVERLAYSYS_BIAS_PROMPT:-fallback}"}"`,
      }),
    ).toBe(true);
  });

  it("returns false for default whisper-stream command (no --prompt support)", () => {
    expect(commandUsesBias(DEFAULT_STT_SPAWNER_CONFIG)).toBe(false);
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
