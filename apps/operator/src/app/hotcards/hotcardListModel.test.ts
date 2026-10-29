import { describe, expect, it } from "vitest";
import type { HotcardMeta } from "@overlaysys/core";
import { hotcardSorts, hotkeyNumber, moveHotkey, outputLabel } from "./hotcardListModel";

const card = (name: string, hotkey?: string | null): HotcardMeta =>
  ({ id: name, name, projectId: "p", templateId: "t", hotkey }) as HotcardMeta;
const key = hotcardSorts.find((s) => s.id === "key-asc")!.compare;

describe("hotcard sorts", () => {
  it("orders F-keys numerically, unassigned last, then by name", () => {
    const list = [card("Zed"), card("B", "F10"), card("A", "F2"), card("Amy", null), card("C", "F2")];
    expect(list.sort(key).map((c) => c.name)).toEqual(["A", "C", "B", "Amy", "Zed"]);
  });
  it("hotkeyNumber parses F-keys only", () => {
    expect(hotkeyNumber({ hotkey: "F12" } as HotcardMeta)).toBe(12);
    expect(hotkeyNumber({ hotkey: null } as HotcardMeta)).toBeNull();
  });
});

describe("outputLabel", () => {
  const channels = [{ id: "lt", name: "Lower thirds" }];
  it("falls back to Program when unset or program/preview", () => {
    expect(outputLabel(undefined, channels)).toBe("Program");
    expect(outputLabel("program", channels)).toBe("Program");
    expect(outputLabel("preview", channels)).toBe("Program");
  });
  it("resolves a channel name, else reports unknown", () => {
    expect(outputLabel("lt", channels)).toBe("Lower thirds");
    expect(outputLabel("gone", channels)).toBe("Unknown output");
  });
});

describe("moveHotkey", () => {
  const cards = [
    { id: "a", projectId: "p1", hotkey: "F5" },
    { id: "b", projectId: "p2", hotkey: "F5" },
    { id: "c", projectId: "p2", hotkey: "F6" },
  ] as HotcardMeta[];
  it("keeps the key when the target does not use it", () => {
    expect(moveHotkey({ id: "a", hotkey: "F5" }, "p3", cards)).toEqual({ hotkey: "F5", droppedFrom: null });
  });
  it("drops the key when the target project uses it", () => {
    expect(moveHotkey({ id: "a", hotkey: "F5" }, "p2", cards)).toEqual({ hotkey: null, droppedFrom: "F5" });
  });
  it("passes through unassigned", () => {
    expect(moveHotkey({ id: "a", hotkey: null }, "p2", cards)).toEqual({ hotkey: null, droppedFrom: null });
  });
});
