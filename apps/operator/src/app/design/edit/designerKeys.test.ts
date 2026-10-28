import { describe, expect, it } from "vitest";
import { escAction, spaceAction } from "./designerKeys";

const base = { repeat: false, panned: false, typing: false };

describe("spaceAction", () => {
  it("arms on first keydown, ignores repeats", () => {
    expect(spaceAction({ ...base, phase: "down" })).toBe("arm");
    expect(spaceAction({ ...base, phase: "down", repeat: true })).toBe("none");
  });
  it("toggles play on keyup only when no pan happened", () => {
    expect(spaceAction({ ...base, phase: "up" })).toBe("toggle-play");
    expect(spaceAction({ ...base, phase: "up", panned: true })).toBe("none");
  });
  it("does nothing while typing", () => {
    expect(spaceAction({ ...base, phase: "down", typing: true })).toBe("none");
    expect(spaceAction({ ...base, phase: "up", typing: true })).toBe("none");
  });
});

describe("escAction", () => {
  it("exits a group first", () => {
    expect(escAction({ inGroup: true, hasSelection: true })).toBe("exit-group");
  });
  it("clears selection when not in a group", () => {
    expect(escAction({ inGroup: false, hasSelection: true })).toBe("clear-selection");
  });
  it("is a no-op otherwise", () => {
    expect(escAction({ inGroup: false, hasSelection: false })).toBe("none");
  });
});
