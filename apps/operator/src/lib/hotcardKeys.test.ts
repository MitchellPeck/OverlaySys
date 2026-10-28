import { describe, expect, it } from "vitest";
import type { HotcardMeta } from "@overlaysys/core";
import { hotkeyConflictWarning, hotkeyOwners } from "./hotcardKeys";

const metas: HotcardMeta[] = [
  { id: "a", name: "Pastor", templateId: "l3", projectId: "sun", hotkey: "F1" },
  { id: "b", name: "Welcome", templateId: "l3", projectId: "sun", hotkey: "F2" },
  { id: "c", name: "Youth", templateId: "l3", projectId: "youth", hotkey: "F3" },
  { id: "d", name: "Spare", templateId: "l3", projectId: "sun", hotkey: null },
];

describe("hotkeyOwners", () => {
  it("names other cards in the project per key, excluding the edited card", () => {
    expect(hotkeyOwners(metas, "sun", "a")).toEqual({ F2: ["Welcome"] });
    expect(hotkeyOwners(metas, "sun", "d")).toEqual({ F1: ["Pastor"], F2: ["Welcome"] });
  });
});

describe("hotkeyConflictWarning", () => {
  it("warns when the draft takes a key another card in the project holds", () => {
    const w = hotkeyConflictWarning(metas, { id: "d", name: "Spare", projectId: "sun", hotkey: "F2" });
    expect(w).toContain("F2");
    expect(w).toContain('"Welcome"');
  });

  it("is quiet for a free key, no key, its own saved key, or another project's key", () => {
    expect(hotkeyConflictWarning(metas, { id: "d", name: "Spare", projectId: "sun", hotkey: "F9" })).toBeNull();
    expect(hotkeyConflictWarning(metas, { id: "d", name: "Spare", projectId: "sun", hotkey: null })).toBeNull();
    expect(hotkeyConflictWarning(metas, { id: "a", name: "Pastor", projectId: "sun", hotkey: "F1" })).toBeNull();
    expect(hotkeyConflictWarning(metas, { id: "d", name: "Spare", projectId: "sun", hotkey: "F3" })).toBeNull();
  });
});
