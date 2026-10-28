import { describe, expect, it } from "vitest";
import { HOTKEYS, HotcardSchema, hotcardForKey, hotkeyConflicts, initialHotkeyAssignments, type Hotkey } from "./hotcard";

describe("HotcardSchema", () => {
  it("parses a minimal hotcard with explicit projectId", () => {
    const h = HotcardSchema.parse({
      id: "hot-1",
      name: "Welcome",
      templateId: "lower-third",
      data: { title: "Welcome" },
      projectId: "sunday-services",
    });
    expect(h.projectId).toBe("sunday-services");
  });

  it("backfills missing projectId to the default project", () => {
    const h = HotcardSchema.parse({
      id: "hot-legacy",
      name: "Old Card",
      templateId: "lower-third",
      data: {},
    });
    expect(h.projectId).toBe("default");
  });
});

describe("hotkey field", () => {
  const base = { id: "h", name: "N", templateId: "t", data: {}, projectId: "p" };
  it("accepts F1–F12, null (no key) or absent", () => {
    expect(HotcardSchema.parse({ ...base, hotkey: "F12" }).hotkey).toBe("F12");
    expect(HotcardSchema.parse({ ...base, hotkey: null }).hotkey).toBeNull();
    expect(HotcardSchema.parse(base).hotkey).toBeUndefined();
  });
  it("rejects other keys", () => {
    expect(() => HotcardSchema.parse({ ...base, hotkey: "F13" })).toThrow();
    expect(() => HotcardSchema.parse({ ...base, hotkey: "KeyA" })).toThrow();
  });
});

const card = (id: string, projectId: string, hotkey?: Hotkey | null) => ({ id, projectId, hotkey });

describe("hotcardForKey", () => {
  const metas = [card("a", "p1", "F1"), card("b", "p1", "F4"), card("c", "p2", "F1"), card("d", "p1", null), card("e", "p1")];

  it("finds the card with that key in the project", () => {
    expect(hotcardForKey(metas, "F4", "p1")?.id).toBe("b");
    expect(hotcardForKey(metas, "F1", "p1")?.id).toBe("a");
    expect(hotcardForKey(metas, "F1", "p2")?.id).toBe("c");
  });

  it("never fires another project's card", () => {
    expect(hotcardForKey(metas, "F4", "p2")).toBeNull();
  });

  it("returns null for an unassigned key, never falling back to position", () => {
    expect(hotcardForKey(metas, "F2", "p1")).toBeNull();
    expect(hotcardForKey(metas, "F5", "p1")).toBeNull();
    expect(hotcardForKey(metas, "KeyF", "p1")).toBeNull();
  });

  it("doesn't depend on list order", () => {
    const reversed = [...metas].reverse();
    for (const k of HOTKEYS) {
      expect(hotcardForKey(reversed, k, "p1")?.id).toBe(hotcardForKey(metas, k, "p1")?.id);
    }
  });

  it("picks the lowest id when two cards share a key", () => {
    const dup = [card("z", "p1", "F3"), card("m", "p1", "F3")];
    expect(hotcardForKey(dup, "F3", "p1")?.id).toBe("m");
    expect(hotcardForKey([...dup].reverse(), "F3", "p1")?.id).toBe("m");
  });
});

describe("hotkeyConflicts", () => {
  it("lists keys used twice within a project only", () => {
    const metas = [card("a", "p1", "F1"), card("b", "p1", "F1"), card("c", "p2", "F1"), card("d", "p1", "F2"), card("e", "p1", null), card("f", "p1", null)];
    expect(hotkeyConflicts(metas, "p1")).toEqual({ F1: ["a", "b"] });
    expect(hotkeyConflicts(metas, "p2")).toEqual({});
  });
});

describe("initialHotkeyAssignments", () => {
  it("assigns F1–F12 in list order per project, null past twelve", () => {
    const cards = Array.from({ length: 13 }, (_, i) => card(`c${i}`, "p1"));
    const out = initialHotkeyAssignments([...cards, card("x", "p2")]);
    expect(out.get("c0")).toBe("F1");
    expect(out.get("c11")).toBe("F12");
    expect(out.get("c12")).toBeNull();
    expect(out.get("x")).toBe("F1");
  });

  it("leaves a project alone once any card is decided (idempotent)", () => {
    expect(initialHotkeyAssignments([card("a", "p1", "F2"), card("b", "p1")]).size).toBe(0);
    expect(initialHotkeyAssignments([card("a", "p1", null), card("b", "p1", null)]).size).toBe(0);
  });
});
