import { describe, expect, it } from "vitest";
import * as spawner from "./sttSpawner";
import type { SttSpawnerConfig } from "@overlaysys/core";

describe("sttSpawner", () => {
  it("starts in idle or stopped state", () => {
    const s = spawner.getStatus();
    expect(["idle", "stopped"]).toContain(s.state);
  });

  it("getStatus returns a fresh snapshot each call", () => {
    const a = spawner.getStatus();
    const b = spawner.getStatus();
    expect(a).not.toBe(b);
    expect(a.recentLogs).not.toBe(b.recentLogs);
  });

  it("subscribe returns an unsubscribe function", () => {
    const off = spawner.subscribe(() => {
      // no-op
    });
    expect(typeof off).toBe("function");
    off(); // should not throw
  });
});

describe("sttSpawner.buildEffectiveCommand", () => {
  const baseCfg: SttSpawnerConfig = {
    autoStart: false,
    command:
      "whisper-stream -m ~/whisper-models/ggml-base.en.bin --step 500 --length 5000",
    biasOnSongStart: true,
  };

  it("returns the base command unchanged when bias is null", () => {
    expect(spawner.buildEffectiveCommand(baseCfg, null)).toBe(baseCfg.command);
  });

  it("returns the base command unchanged when biasOnSongStart is off", () => {
    expect(
      spawner.buildEffectiveCommand({ ...baseCfg, biasOnSongStart: false }, "amazing grace"),
    ).toBe(baseCfg.command);
  });

  it("appends --prompt when bias is set on a whisper-stream command", () => {
    const out = spawner.buildEffectiveCommand(baseCfg, "amazing grace how sweet");
    expect(out).toContain(baseCfg.command);
    expect(out).toContain("--prompt");
    expect(out).toContain("amazing grace how sweet");
  });

  it("single-quote escapes embedded apostrophes safely", () => {
    const out = spawner.buildEffectiveCommand(baseCfg, "I've been set free");
    // Embedded ' must be closed-escaped-reopened so bash sees a single
    // contiguous quoted string.
    expect(out).toContain(`'I'\\''ve been set free'`);
  });

  it("does NOT inject --prompt for non-whisper commands", () => {
    const customCfg: SttSpawnerConfig = {
      ...baseCfg,
      command: "my-custom-stt --some-flag",
    };
    expect(spawner.buildEffectiveCommand(customCfg, "amazing grace")).toBe(
      customCfg.command,
    );
  });

  it("truncates very long bias text to keep the prompt under whisper's limit", () => {
    const longBias = "amazing grace ".repeat(200); // ~2800 chars
    const out = spawner.buildEffectiveCommand(baseCfg, longBias);
    // Effective command should be base + " --prompt '<at most 600 chars>'".
    // The whole thing must be reasonably bounded.
    expect(out.length).toBeLessThan(baseCfg.command.length + 700);
  });
});
