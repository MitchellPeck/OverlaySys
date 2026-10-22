import { describe, expect, it } from "vitest";
import { channelsToOpenOnDisplayChange, shouldAutoOpen } from "./windowPrefs";

describe("shouldAutoOpen", () => {
  it("skips channels that aren't set to auto-open", () => {
    expect(shouldAutoOpen({ autoOpen: false, displayId: 7 }, "id")).toBe(false);
  });

  it("opens on the saved display only when that exact display is connected", () => {
    expect(shouldAutoOpen({ autoOpen: true, displayId: 7 }, "id")).toBe(true);
  });

  it("a same-name or same-resolution screen doesn't count as the saved display", () => {
    // e.g. the main monitor is the same model / resolution as the TVs
    expect(shouldAutoOpen({ autoOpen: true, displayId: 7 }, "label")).toBe(false);
    expect(shouldAutoOpen({ autoOpen: true, displayId: 7 }, "bounds")).toBe(false);
  });

  it("skips a channel whose saved display isn't connected", () => {
    expect(shouldAutoOpen({ autoOpen: true, displayId: 7 }, "fallback")).toBe(false);
  });

  it("opens a channel with no saved display on the primary, as before", () => {
    expect(shouldAutoOpen({ autoOpen: true }, "fallback")).toBe(true);
  });
});

describe("channelsToOpenOnDisplayChange", () => {
  const channels = {
    program: { autoOpen: true, displayId: 7 },
    preview: { autoOpen: true, displayId: 8 },
    stage: { autoOpen: false, displayId: 9 },
    lobby: { autoOpen: true, displayId: 10 },
  };

  it("opens auto-open channels that now find their display and aren't already open", () => {
    const matched = { 7: "id", 8: "fallback", 9: "id", 10: "label" } as const;
    const out = channelsToOpenOnDisplayChange(
      channels,
      (p) => matched[p.displayId as keyof typeof matched],
      (id) => id === "lobby",
    );
    expect(out).toEqual(["program"]);
  });

  it("does not open on a hot-plug that only matches by name or resolution", () => {
    const out = channelsToOpenOnDisplayChange(
      { a: { autoOpen: true, displayId: 7 }, b: { autoOpen: true, displayId: 8 } },
      (p) => (p.displayId === 7 ? "label" : "bounds"),
      () => false,
    );
    expect(out).toEqual([]);
  });

  it("never opens channels without a saved display on hot-plug", () => {
    expect(
      channelsToOpenOnDisplayChange({ x: { autoOpen: true } }, () => "fallback", () => false),
    ).toEqual([]);
  });
});
