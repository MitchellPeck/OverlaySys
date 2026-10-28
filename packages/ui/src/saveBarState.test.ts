import { describe, expect, it } from "vitest";
import { saveBarState } from "./saveBarState";

describe("saveBarState", () => {
  it("dirty is unsaved and enabled", () => {
    expect(saveBarState({ dirty: true, saving: false, justSaved: false })).toMatchObject({ status: "unsaved", saveEnabled: true, revertEnabled: true, saveTitle: "Save (⌘S)" });
  });
  it("disabledReason blocks save but not revert", () => {
    expect(saveBarState({ dirty: true, saving: false, justSaved: false, disabledReason: "Reconnect to save" })).toMatchObject({ saveEnabled: false, saveTitle: "Reconnect to save", revertEnabled: true });
  });
  it("just saved shows Saved", () => {
    expect(saveBarState({ dirty: false, saving: false, justSaved: true }).statusText).toBe("Saved");
  });
  it("clean disables save", () => {
    expect(saveBarState({ dirty: false, saving: false, justSaved: false })).toMatchObject({ status: "clean", statusText: "", saveEnabled: false, saveTitle: "No changes to save" });
  });
  it("saving disables both", () => {
    expect(saveBarState({ dirty: true, saving: true, justSaved: false })).toMatchObject({ status: "saving", statusText: "Saving…", saveEnabled: false, revertEnabled: false });
  });
});
