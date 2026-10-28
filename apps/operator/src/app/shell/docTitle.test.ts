import { describe, expect, it } from "vitest";
import { composeDocTitle } from "./docTitle";

describe("composeDocTitle", () => {
  it("uses a string title", () => {
    expect(composeDocTitle(undefined, "Channels")).toBe("Channels · OverlaySys");
  });
  it("prefers docTitle over a non-string title", () => {
    expect(composeDocTitle("Edit Section Intro", { type: "span" })).toBe(
      "Edit Section Intro · OverlaySys",
    );
  });
  it("falls back to the app name", () => {
    expect(composeDocTitle(undefined, undefined)).toBe("OverlaySys");
  });
});
