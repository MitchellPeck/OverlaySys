import { describe, expect, it } from "vitest";
import { folderFromDialogResult } from "./folderPick";

describe("folderFromDialogResult", () => {
  it("returns null when canceled or empty, else the first path", () => {
    expect(folderFromDialogResult({ canceled: true, filePaths: ["/a"] })).toBeNull();
    expect(folderFromDialogResult({ canceled: false, filePaths: [] })).toBeNull();
    expect(folderFromDialogResult({ canceled: false, filePaths: ["/a", "/b"] })).toBe("/a");
  });
});
