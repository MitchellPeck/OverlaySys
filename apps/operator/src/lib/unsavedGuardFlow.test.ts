import { describe, expect, it } from "vitest";
import { afterChoice, guardActions } from "./unsavedGuardFlow";

describe("unsavedGuardFlow", () => {
  it("offers Save and leave only when the page can save", () => {
    expect(guardActions(false).map((a) => a.id)).toEqual(["stay", "discard"]);
    expect(guardActions(true).map((a) => a.label)).toEqual(["Stay", "Discard changes", "Save and leave"]);
    expect(guardActions(true).map((a) => a.variant)).toEqual(["secondary", "danger", "primary"]);
  });

  it("maps a choice to navigation and history steps", () => {
    expect(afterChoice("discard", null, "pop")).toEqual({ navigate: true, historySteps: -2 });
    expect(afterChoice("discard", null, "link")).toEqual({ navigate: true, historySteps: 0 });
    expect(afterChoice("save", false, "link")).toEqual({ navigate: false, historySteps: 0 });
    expect(afterChoice("save", true, "pop")).toEqual({ navigate: true, historySteps: -2 });
    expect(afterChoice("stay", null, "pop")).toEqual({ navigate: false, historySteps: 0 });
  });
});
