import { describe, expect, it } from "vitest";
import { isSaveShortcut, nameToCommit } from "./nameEdit";

describe("nameToCommit", () => {
  it("returns the trimmed new name", () => {
    expect(nameToCommit("  New  ", "Old")).toBe("New");
  });
  it("is null when unchanged or blank (a template is never nameless)", () => {
    expect(nameToCommit("Old", "Old")).toBeNull();
    expect(nameToCommit("Old ", "Old")).toBeNull();
    expect(nameToCommit("   ", "Old")).toBeNull();
  });
});

describe("isSaveShortcut", () => {
  const k = (o: Partial<{ key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }>) => ({
    key: "s",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...o,
  });
  it("matches ⌘S and Ctrl+S, either case", () => {
    expect(isSaveShortcut(k({ metaKey: true }))).toBe(true);
    expect(isSaveShortcut(k({ ctrlKey: true, key: "S" }))).toBe(true);
  });
  it("ignores plain s and shifted / alt variants", () => {
    expect(isSaveShortcut(k({}))).toBe(false);
    expect(isSaveShortcut(k({ metaKey: true, shiftKey: true }))).toBe(false);
    expect(isSaveShortcut(k({ metaKey: true, altKey: true }))).toBe(false);
  });
});
