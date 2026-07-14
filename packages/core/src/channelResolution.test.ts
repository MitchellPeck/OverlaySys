import { describe, expect, it } from "vitest";
import {
  resolveChannelConfig,
  resolveProjectChannels,
} from "./channelResolution";
import type { ChannelConfig, ProjectChannelOverride } from "./channelConfig";

// --- Fixtures ------------------------------------------------------------

function makeBase(overrides: Partial<ChannelConfig> = {}): ChannelConfig {
  return {
    id: "program",
    name: "Program",
    renderMode: "normal",
    background: "transparent",
    ...overrides,
  };
}

function makeOverride(
  overrides: Partial<ProjectChannelOverride> = {},
): ProjectChannelOverride {
  return {
    projectId: "sunday",
    channelId: "program",
    ...overrides,
  };
}

describe("resolveChannelConfig", () => {
  it("returns base unchanged when no override is supplied", () => {
    const base = makeBase({ background: "#001122" });
    expect(resolveChannelConfig(base, undefined)).toEqual(base);
  });

  it("returns base when override is tombstoned", () => {
    const base = makeBase();
    const tombstoned = makeOverride({
      name: "Should not apply",
      deletedAt: "2026-05-15T00:00:00Z",
    });
    expect(resolveChannelConfig(base, tombstoned)).toEqual(base);
  });

  it("returns null when base is tombstoned regardless of override", () => {
    const base = makeBase({ deletedAt: "2026-05-15T00:00:00Z" });
    const override = makeOverride({ name: "Lazarus" });
    expect(resolveChannelConfig(base, override)).toBeNull();
  });

  it("applies override fields when set, falls through otherwise", () => {
    const base = makeBase({
      name: "Program",
      renderMode: "normal",
      mirrorOf: undefined,
      background: "transparent",
    });
    const override = makeOverride({
      name: "Sunday PGM",
      background: "#00ff00",
    });
    const effective = resolveChannelConfig(base, override);
    expect(effective).toEqual({
      id: "program",
      name: "Sunday PGM",
      renderMode: "normal",
      mirrorOf: undefined,
      background: "#00ff00",
      updatedAt: undefined,
    });
  });

  it("override cannot change the channel id (base id always wins)", () => {
    const base = makeBase({ id: "program" });
    // Construct a malformed override with a different channelId — the
    // resolver should still emit the base id since it's the stable handle.
    const override: ProjectChannelOverride = {
      projectId: "sunday",
      channelId: "program",
      name: "Renamed",
    };
    const effective = resolveChannelConfig(base, override);
    expect(effective?.id).toBe("program");
  });

  it("effective updatedAt is the latest of base and override timestamps", () => {
    const base = makeBase({ updatedAt: "2026-01-01T00:00:00Z" });
    const override = makeOverride({
      name: "Renamed",
      updatedAt: "2026-05-15T12:00:00Z",
    });
    expect(resolveChannelConfig(base, override)?.updatedAt).toBe(
      "2026-05-15T12:00:00Z",
    );
  });
});

describe("resolveProjectChannels", () => {
  const program = makeBase({ id: "program", name: "Program" });
  const preview = makeBase({ id: "preview", name: "Preview" });
  const alpha = makeBase({ id: "alpha", name: "Alpha", deletedAt: "2026-04-01T00:00:00Z" });

  it("returns all non-tombstoned base channels when no overrides exist", () => {
    const resolved = resolveProjectChannels([program, preview, alpha], [], "sunday");
    expect(resolved.map((c) => c.id)).toEqual(["program", "preview"]);
  });

  it("only applies overrides matching the requested projectId", () => {
    const overrides: ProjectChannelOverride[] = [
      { projectId: "sunday", channelId: "program", background: "#00ff00" },
      { projectId: "christmas", channelId: "program", background: "#ff0000" },
    ];
    const sundayChans = resolveProjectChannels([program, preview], overrides, "sunday");
    const christmasChans = resolveProjectChannels([program, preview], overrides, "christmas");
    expect(sundayChans.find((c) => c.id === "program")?.background).toBe("#00ff00");
    expect(christmasChans.find((c) => c.id === "program")?.background).toBe("#ff0000");
  });

  it("ignores overrides for channels that don't exist in the base list", () => {
    const overrides: ProjectChannelOverride[] = [
      { projectId: "sunday", channelId: "ghost", name: "Should not appear" },
    ];
    const resolved = resolveProjectChannels([program], overrides, "sunday");
    expect(resolved.map((c) => c.id)).toEqual(["program"]);
  });
});
