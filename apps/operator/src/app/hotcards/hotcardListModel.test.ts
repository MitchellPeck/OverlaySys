import { describe, expect, it } from "vitest";
import type { HotcardMeta } from "@overlaysys/core";
import { hotcardSorts, hotkeyNumber } from "./hotcardListModel";

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
