import { describe, expect, it } from "vitest";
import type { RowLike } from "./rowLike";
import { slidesRowTakeMessage } from "./slidesLive";

const row: RowLike = { kind: "slides", id: "r1", deckId: "d1" };

describe("slidesRowTakeMessage", () => {
  it("take goes to program by default", () => {
    expect(slidesRowTakeMessage("s", row, "take")).toEqual({ type: "slides_take", showId: "s", rowId: "r1", channel: "program" });
  });
  it("take honours channelHint", () => {
    expect(slidesRowTakeMessage("s", { ...row, channelHint: "lobby" } as RowLike, "take")).toMatchObject({ channel: "lobby" });
  });
  it("cue goes to preview even with a hint", () => {
    expect(slidesRowTakeMessage("s", { ...row, channelHint: "lobby" } as RowLike, "cue")).toMatchObject({ channel: "preview" });
  });
});
