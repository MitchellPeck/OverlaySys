import { describe, expect, it } from "vitest";
import type { Hotcard, TemplateMeta } from "@overlaysys/core";
import { buildNewHotcard, carryFieldValues, hotcardEqual, templatesForHotcard } from "./hotcardDraft";

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

describe("carryFieldValues", () => {
  it("keeps values for keys the template declares and drops the rest", () => {
    expect(carryFieldValues({ a: "1", b: "2", c: "3" }, [{ key: "a" }, { key: "c" }])).toEqual({ a: "1", c: "3" });
  });
  it("drops everything when the template has no fields", () => {
    expect(carryFieldValues({ a: "1" }, [])).toEqual({});
  });
});

describe("buildNewHotcard", () => {
  it("saves the typed field values as the card's data", () => {
    const h = buildNewHotcard(
      { name: "Hi", templateId: "lt", hotkey: "F2", data: { title: "Welcome" } },
      "proj",
      "hotcard-1",
    );
    expect(h).toEqual({
      id: "hotcard-1",
      name: "Hi",
      projectId: "proj",
      templateId: "lt",
      data: { title: "Welcome" },
      hotkey: "F2",
    });
  });
});
