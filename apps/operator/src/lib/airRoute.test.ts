import { describe, expect, it } from "vitest";
import { cueTakeRoute } from "./airRoute";

describe("cueTakeRoute", () => {
  it.each([
    [undefined, "cue", "preview"],
    ["program", "cue", "preview"],
    ["preview", "cue", "preview"],
    ["stage-1", "cue", "preview"],
    [undefined, "take", "program"],
    ["program", "take", "program"],
    ["preview", "take", "program"],
    ["stage-1", "take", "stage-1"],
  ])("cueTakeRoute(%s, %s) → %s", (hint, action, want) =>
    expect(cueTakeRoute(hint, action as "cue" | "take")).toBe(want),
  );
});
