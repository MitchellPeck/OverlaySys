import { describe, expect, it } from "vitest";
import { ChannelStateSchema, ScriptureRowSchema, ScriptureSettingsSchema } from "./index";

const row = {
  kind: "scripture",
  id: "s1",
  reference: "John 3:16",
  translation: "KJV",
  slides: [{ id: "slide-0", verses: [{ book: "JHN", chapter: 3, verse: 16, text: "For God" }] }],
  templateId: "t",
};

describe("scripture schemas", () => {
  it("scripture rows keep intro fields", () => {
    const r = ScriptureRowSchema.parse({
      ...row,
      introTemplateId: "intro",
      introFieldMap: { title: "reference" },
      introFieldLiterals: { sub: "{translation}" },
      skipIntro: false,
    });
    expect(r.introTemplateId).toBe("intro");
    expect(r.introFieldMap).toEqual({ title: "reference" });
    expect(r.introFieldLiterals).toEqual({ sub: "{translation}" });
    expect(r.skipIntro).toBe(false);
  });

  it("settings accept an empty object and a full default", () => {
    expect(ScriptureSettingsSchema.parse({})).toEqual({});
    expect(
      ScriptureSettingsSchema.parse({ introTemplateId: "i", introFieldMap: { a: "reference" }, introFieldLiterals: {} }),
    ).toMatchObject({ introTemplateId: "i" });
  });

  it("channel state carries scripture session, queue and context", () => {
    const s = ChannelStateSchema.parse({
      channel: "program",
      active: { templateId: "t", data: {}, phase: "in", takenAt: 1, scriptureContext: { rowId: "s1", sub: "slide", slideIdx: 2 } },
      scriptureSession: { rowId: "s1", reference: "John 3:16-21", slideIdx: 2, slideCount: 5, slideReference: "John 3:18", text: "x" },
      queuedScripture: { rowId: "s1", reference: "John 3:16-21" },
    });
    expect(s.active?.scriptureContext).toEqual({ rowId: "s1", sub: "slide", slideIdx: 2 });
    expect(s.scriptureSession?.slideCount).toBe(5);
    expect(s.queuedScripture?.rowId).toBe("s1");
  });

  it("an intro context has no slideIdx", () => {
    const s = ChannelStateSchema.parse({
      channel: "program",
      active: { templateId: "t", data: {}, phase: "in", takenAt: 1, scriptureContext: { rowId: "s1", sub: "intro" } },
    });
    expect(s.active?.scriptureContext).toEqual({ rowId: "s1", sub: "intro" });
  });
});
