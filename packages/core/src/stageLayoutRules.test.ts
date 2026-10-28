import { describe, expect, it } from "vitest";
import { ChannelConfigSchema } from "./channelConfig";
import { RundownRowSchema } from "./show";
import { resolveStageLayout } from "./stageLayoutRules";

describe("resolveStageLayout", () => {
  const rules = { song: "r" };
  it("manual wins over everything", () => {
    expect(resolveStageLayout({ manual: "m", rowOverride: "i", rules, default: "d", liveRowKind: "song" })).toEqual({ layoutId: "m", reason: "manual" });
  });
  it("item override beats rules and default", () => {
    expect(resolveStageLayout({ rowOverride: "i", rules, default: "d", liveRowKind: "song" })).toEqual({ layoutId: "i", reason: "item" });
  });
  it("type rule beats default", () => {
    expect(resolveStageLayout({ rules, default: "d", liveRowKind: "song" })).toEqual({ layoutId: "r", reason: "rule:song" });
  });
  it("kind without a rule falls to default", () => {
    expect(resolveStageLayout({ rules, default: "d", liveRowKind: "scripture" })).toEqual({ layoutId: "d", reason: "default" });
  });
  it("no live row and unknown kinds fall to default", () => {
    expect(resolveStageLayout({ rules, default: "d", liveRowKind: null })).toEqual({ layoutId: "d", reason: "default" });
    expect(resolveStageLayout({ rules, default: "d", liveRowKind: "bogus" })).toEqual({ layoutId: "d", reason: "default" });
  });
  it("empty strings count as unset", () => {
    expect(resolveStageLayout({ manual: "", default: "d" }).reason).toBe("default");
    expect(resolveStageLayout({ manual: "", rowOverride: "", rules: { song: "" }, default: "d", liveRowKind: "song" })).toEqual({ layoutId: "d", reason: "default" });
    expect(resolveStageLayout({}).layoutId).toBeUndefined();
  });
});

describe("layoutRules and stageLayouts schemas", () => {
  it("a stored stage config without layoutRules parses unchanged", () => {
    const c = ChannelConfigSchema.parse({ id: "s", name: "S", kind: "stage", layoutId: "speaker" });
    expect(c.layoutRules).toBeUndefined();
    expect(c.layoutId).toBe("speaker");
  });
  it("layoutRules round-trips", () => {
    const c = ChannelConfigSchema.parse({ id: "s", name: "S", kind: "stage", layoutRules: { song: "lyrics" } });
    expect(c.layoutRules).toEqual({ song: "lyrics" });
  });
  it("rows round-trip stageLayouts; old rows parse without it", () => {
    const rows = [
      { kind: "graphic", id: "g", templateId: "t", data: {} },
      { kind: "song", id: "s", songId: "x", lyricTemplateId: "t" },
      { kind: "scripture", id: "c", reference: "John 3:16", translation: "ESV", templateId: "t", slides: [{ id: "s1", verses: [{ book: "John", chapter: 3, verse: 16, text: "Placeholder text" }] }] },
      { kind: "video", id: "v", assetUrl: "/a.mp4" },
    ];
    for (const r of rows) {
      const withLayouts = RundownRowSchema.parse({ ...r, stageLayouts: { stage1: "lyrics" } }) as { stageLayouts?: unknown };
      expect(withLayouts.stageLayouts).toEqual({ stage1: "lyrics" });
      expect((RundownRowSchema.parse(r) as { stageLayouts?: unknown }).stageLayouts).toBeUndefined();
      expect(RundownRowSchema.safeParse({ ...r, stageLayouts: { stage1: 5 } }).success).toBe(false);
      expect(RundownRowSchema.safeParse({ ...r, stageLayouts: "x" }).success).toBe(false);
    }
  });
  it("layoutRules rejects non-string values", () => {
    expect(ChannelConfigSchema.safeParse({ id: "s", name: "S", kind: "stage", layoutRules: { song: 5 } }).success).toBe(false);
  });
});
