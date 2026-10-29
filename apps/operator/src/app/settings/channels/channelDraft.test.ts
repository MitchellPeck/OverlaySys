import { describe, expect, it } from "vitest";
import type { ChannelConfig } from "@overlaysys/core";
import { channelConfigEqual, deleteImpact, draftAfterSave, newChannelDefaults, setLayoutRule, sortChannels } from "./channelDraft";

const g = (o: Partial<ChannelConfig> & { id: string; name: string }): ChannelConfig =>
  ({ kind: "graphics", renderMode: "normal", background: "transparent", ...o }) as ChannelConfig;

describe("channelConfigEqual", () => {
  it("ignores undefined optionals and key order", () => {
    expect(
      channelConfigEqual(
        { id: "a", name: "A", kind: "graphics" } as ChannelConfig,
        { kind: "graphics", name: "A", id: "a", mirrorOf: undefined } as ChannelConfig,
      ),
    ).toBe(true);
  });
  it("treats defaults as equal to absent", () => {
    expect(channelConfigEqual(g({ id: "a", name: "A" }), { id: "a", name: "A" } as ChannelConfig)).toBe(true);
    expect(
      channelConfigEqual(
        { id: "s", name: "S", kind: "stage" } as ChannelConfig,
        { id: "s", name: "S", kind: "stage", follows: "program", layoutId: "speaker", layoutRules: {} } as ChannelConfig,
      ),
    ).toBe(true);
  });
  it("detects a different layoutId, name, mirror and rules", () => {
    const s = { id: "s", name: "S", kind: "stage", layoutId: "speaker" } as ChannelConfig;
    expect(channelConfigEqual(s, { ...s, layoutId: "lyrics" })).toBe(false);
    expect(channelConfigEqual(s, { ...s, name: "S2" })).toBe(false);
    expect(channelConfigEqual(g({ id: "a", name: "A" }), g({ id: "a", name: "A", mirrorOf: "program" }))).toBe(false);
    expect(channelConfigEqual(s, { ...s, layoutRules: { song: "lyrics" } })).toBe(false);
  });
});

describe("sortChannels", () => {
  it("puts program and preview first, then by name", () => {
    const out = sortChannels([
      g({ id: "z", name: "Zed" }),
      g({ id: "preview", name: "Preview" }),
      g({ id: "a", name: "Alpha" }),
      g({ id: "program", name: "Program" }),
    ]);
    expect(out.map((c) => c.id)).toEqual(["program", "preview", "a", "z"]);
  });
});

describe("newChannelDefaults", () => {
  it("stage defaults", () => {
    const d = newChannelDefaults("stage");
    expect(d.layoutId).toBe("speaker");
    expect(d.follows).toBe("program");
    expect(d.kind).toBe("stage");
  });
  it("graphics defaults", () => {
    const d = newChannelDefaults("graphics");
    expect(d.renderMode).toBe("normal");
    expect(d.mirrorOf).toBeUndefined();
  });
});

describe("setLayoutRule", () => {
  const cfg = { id: "s", name: "S", kind: "stage" } as ChannelConfig;
  it("sets and removes, deleting the key at the end", () => {
    const a = setLayoutRule(cfg, "song", "lyrics");
    expect(a.layoutRules).toEqual({ song: "lyrics" });
    const b = setLayoutRule(a, "song", null);
    expect("layoutRules" in b).toBe(false);
    expect(b).toEqual(cfg);
  });
  it("keeps other rules", () => {
    const a = setLayoutRule(setLayoutRule(cfg, "song", "lyrics"), "video", "speaker");
    expect(setLayoutRule(a, "song", null).layoutRules).toEqual({ video: "speaker" });
  });
});

describe("draftAfterSave", () => {
  const saved = g({ id: "a", name: "A" });
  it("clears the draft when it equals what was saved", () => {
    expect(draftAfterSave({ ...saved }, saved)).toBeNull();
  });
  it("keeps edits typed during the save", () => {
    const typed = { ...saved, name: "A2" };
    expect(draftAfterSave(typed, saved)).toBe(typed);
  });
});

describe("deleteImpact", () => {
  const cs = [
    g({ id: "program", name: "Program" }),
    g({ id: "alpha", name: "Alpha", mirrorOf: "program" }),
    { id: "s", name: "Stage", kind: "stage", follows: "program" } as ChannelConfig,
    { id: "s2", name: "Stage 2", kind: "stage", follows: "other" } as ChannelConfig,
  ];
  it("blocks program and preview", () => {
    expect(deleteImpact("program", cs, true).blocked).toBeTruthy();
    expect(deleteImpact("preview", cs, false).blocked).toBeTruthy();
  });
  it("lists mirrors and followers", () => {
    expect(deleteImpact("program", cs, false).dependents).toEqual(["Alpha", "Stage"]);
    expect(deleteImpact("alpha", cs, false)).toEqual({ blocked: null, onAir: false, dependents: [] });
  });
});
