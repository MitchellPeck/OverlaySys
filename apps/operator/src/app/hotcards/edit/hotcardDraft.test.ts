import { describe, expect, it } from "vitest";
import type { Hotcard, TemplateMeta } from "@overlaysys/core";
import { hotcardEqual, templatesForHotcard } from "./hotcardDraft";

const meta = (id: string, name: string) => ({ id, name, size: { w: 1920, h: 1080 } }) as TemplateMeta;
const metas = [meta("lyric-default", "Lyric — Default"), meta("lt", "Lower Third")];

describe("templatesForHotcard", () => {
  it("suggests graphics; lyric templates land in others", () => {
    const r = templatesForHotcard(metas);
    expect(r.suggested.map((t) => t.id)).toEqual(["lt"]);
    expect(r.others.map((t) => t.id)).toEqual(["lyric-default"]);
    expect(r.defaultId).toBe("lt");
  });
  it("defaults to the last used template", () => {
    expect(templatesForHotcard(metas, "lt").defaultId).toBe("lt");
  });
  it("an unknown last-used id falls back to the first suggested", () => {
    expect(templatesForHotcard(metas, "gone").defaultId).toBe("lt");
  });
  it("no suggestions means no default", () => {
    expect(templatesForHotcard([meta("l", "Lyric")]).defaultId).toBeUndefined();
  });
});

const base: Hotcard = { id: "h", name: "A", projectId: "p", templateId: "t", data: { a: "1", b: "2" } };

describe("hotcardEqual", () => {
  it("ignores key order", () => {
    expect(
      hotcardEqual(base, { templateId: "t", projectId: "p", name: "A", id: "h", data: { b: "2", a: "1" } }),
    ).toBe(true);
  });
  it("treats an undefined hotkey as absent", () => {
    expect(hotcardEqual(base, { ...base, hotkey: undefined })).toBe(true);
  });
  it("detects real changes", () => {
    expect(hotcardEqual(base, { ...base, data: { a: "1", b: "3" } })).toBe(false);
    expect(hotcardEqual(base, { ...base, hotkey: null })).toBe(false);
  });
});
