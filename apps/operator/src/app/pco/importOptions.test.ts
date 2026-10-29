import { describe, expect, it } from "vitest";
import { humaniseItemType, importOptions, importSummary } from "./importOptions";

describe("importOptions", () => {
  it("omits Song when the item has no PCO song", () => {
    expect(importOptions({ song: undefined }).map((o) => o.value)).toEqual(["graphic", "slides", "skip"]);
  });
  it("offers Song, Graphic and Skip for a song item", () => {
    const song = { id: "s1", title: "T" } as never;
    expect(importOptions({ song }).map((o) => o.value)).toEqual(["song", "graphic", "slides", "skip"]);
  });
  it("every item offers Slides", () => {
    expect(importOptions({ song: undefined }).some((o) => o.value === "slides" && o.label === "Slides")).toBe(true);
    expect(importOptions({ song: { id: "s1", title: "T" } as never }).some((o) => o.value === "slides")).toBe(true);
  });
});

describe("importSummary", () => {
  it("singular item", () => {
    expect(importSummary([{ include: true, importAs: "graphic" }])).toEqual({
      label: "Import 1 item",
      count: 1,
    });
  });
  it("plural with songs, ignoring skipped and unchecked rows", () => {
    const s = importSummary([
      { include: true, importAs: "song" },
      { include: true, importAs: "song" },
      { include: true, importAs: "graphic" },
      { include: true, importAs: "skip" },
      { include: false, importAs: "graphic" },
    ]);
    expect(s).toEqual({ label: "Import 3 items (2 songs)", count: 3 });
  });
  it("singular song", () => {
    expect(importSummary([{ include: true, importAs: "song" }]).label).toBe("Import 1 item (1 song)");
  });
});

describe("humaniseItemType", () => {
  it("maps known types", () => {
    expect(humaniseItemType("song")).toBe("Song");
    expect(humaniseItemType("item")).toBe("Item");
    expect(humaniseItemType("media")).toBe("Media");
  });
});
