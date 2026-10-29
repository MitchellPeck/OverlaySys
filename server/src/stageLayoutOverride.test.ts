import { beforeEach, describe, expect, it } from "vitest";
import type { ChannelConfig, ChannelState, Show } from "@overlaysys/core";
import {
  decideLayout,
  followedHasContent,
  getManualStageLayout,
  noteFollowedRow,
  resetStageLayoutOverrides,
  setManualStageLayout,
} from "./stageLayoutOverride";

describe("stageLayoutOverride", () => {
  beforeEach(resetStageLayoutOverrides);

  it("sets and reads, and null returns to automatic", () => {
    expect(getManualStageLayout("s1")).toBeNull();
    setManualStageLayout("s1", "lyrics");
    expect(getManualStageLayout("s1")).toBe("lyrics");
    setManualStageLayout("s1", null);
    expect(getManualStageLayout("s1")).toBeNull();
  });

  it("keeps the manual layout while the same row stays live", () => {
    noteFollowedRow("s1", "r1");
    setManualStageLayout("s1", "lyrics");
    expect(noteFollowedRow("s1", "r1")).toBe(false);
    expect(getManualStageLayout("s1")).toBe("lyrics");
  });

  it("clears on a different row id", () => {
    noteFollowedRow("s1", "r1");
    setManualStageLayout("s1", "lyrics");
    expect(noteFollowedRow("s1", "r2")).toBe(true);
    expect(getManualStageLayout("s1")).toBeNull();
  });

  it("counts null -> row as a new row", () => {
    noteFollowedRow("s1", null);
    setManualStageLayout("s1", "lyrics");
    expect(noteFollowedRow("s1", "x")).toBe(true);
    expect(getManualStageLayout("s1")).toBeNull();
  });

  it("tracks channels independently", () => {
    noteFollowedRow("s1", "r1");
    noteFollowedRow("s2", "r1");
    setManualStageLayout("s2", "lyrics");
    noteFollowedRow("s1", "r2");
    expect(getManualStageLayout("s2")).toBe("lyrics");
  });

  it("[P3.22] a slides row's stage override beats the screen's slides rule; manual still wins", () => {
    const cfg = { id: "band", kind: "stage", layoutId: "def", layoutRules: { slides: "rule-slides", song: "rule-song" } } as unknown as ChannelConfig;
    const followed = { liveRow: { showId: "sh", rowId: "r1" }, slidesSession: { rowId: "r1" } } as unknown as ChannelState;
    const show = (stageLayouts?: Record<string, string>) =>
      ({ id: "sh", rows: [{ kind: "slides", id: "r1", deckId: "d", ...(stageLayouts ? { stageLayouts } : {}) }] }) as unknown as Show;
    expect(decideLayout(cfg, followed, show())).toEqual({ layoutId: "rule-slides", reason: "rule:slides" });
    expect(decideLayout(cfg, followed, show({ band: "item-lay" }))).toEqual({ layoutId: "item-lay", reason: "item" });
    setManualStageLayout("band", "man");
    expect(decideLayout(cfg, followed, show({ band: "item-lay" }))).toEqual({ layoutId: "man", reason: "manual" });
  });

  it("[I2] falls back to the default when the followed output has nothing live (sticky liveRow)", () => {
    const cfg = { id: "band", kind: "stage", layoutId: "def", layoutRules: { song: "rule-song" } } as unknown as ChannelConfig;
    const show = { id: "sh", rows: [{ kind: "song", id: "r1", songId: "s", stageLayouts: { band: "item-lay" } }] } as unknown as Show;
    const live = { liveRow: { showId: "sh", rowId: "r1" }, songSession: { songId: "s" } } as unknown as ChannelState;
    expect(decideLayout(cfg, live, show)).toEqual({ layoutId: "item-lay", reason: "item" });
    // Cleared: liveRow sticks, nothing on air.
    const cleared = { liveRow: { showId: "sh", rowId: "r1" }, active: null } as unknown as ChannelState;
    expect(decideLayout(cfg, cleared, show)).toEqual({ layoutId: "def", reason: "default" });
    // Graphic animating out counts as nothing live.
    const out = { liveRow: { showId: "sh", rowId: "r1" }, active: { phase: "out", templateId: "t", data: {} } } as unknown as ChannelState;
    expect(decideLayout(cfg, out, show).reason).toBe("default");
    // Manual still wins with nothing live.
    setManualStageLayout("band", "man");
    expect(decideLayout(cfg, cleared, show)).toEqual({ layoutId: "man", reason: "manual" });
  });

  it("[I2] followedHasContent", () => {
    expect(followedHasContent(null)).toBe(false);
    expect(followedHasContent({ active: { phase: "in" } } as unknown as ChannelState)).toBe(true);
    expect(followedHasContent({ media: { assetId: "a" } } as unknown as ChannelState)).toBe(true);
    expect(followedHasContent({ queuedSong: { songId: "s" } } as unknown as ChannelState)).toBe(false);
  });
});
