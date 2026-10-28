import { describe, expect, it } from "vitest";
import type { ChannelState } from "@overlaysys/core";
import type { RowLike } from "./rowLike";
import { slidesRowTakeMessage, slidesThumbClickMessage } from "./slidesLive";

const session = (rowId: string) => ({
  rowId,
  title: "Deck A",
  slideIdx: 0,
  slideCount: 3,
  lines: ["Line A"],
  blanked: false,
  atEnd: false,
});
const st = (o: object): ChannelState => o as ChannelState;
const live = { program: st({ slidesSession: session("r1") }) };
const row: RowLike = { kind: "slides", id: "r1", deckId: "d1" };

describe("slidesThumbClickMessage", () => {
  it("goto on program when this row is live there", () => {
    expect(slidesThumbClickMessage({ showId: "s", row, position: 2, states: live })).toEqual({ type: "slides_goto", channel: "program", slideIdx: 2 });
  });
  it("cues to preview when nothing is live", () => {
    expect(slidesThumbClickMessage({ showId: "s", row, position: 1, states: {} })).toEqual({ type: "slides_take", showId: "s", rowId: "r1", slideIdx: 1, channel: "preview" });
  });
  it("click on a row that is live on preview but not program cues to preview", () => {
    const states = { preview: st({ slidesSession: session("r1") }) };
    expect(slidesThumbClickMessage({ showId: "s", row, position: 1, states })).toEqual({ type: "slides_take", showId: "s", rowId: "r1", slideIdx: 1, channel: "preview" });
  });
  it("a different row live on program still cues to preview", () => {
    const states = { program: st({ slidesSession: session("other") }) };
    expect(slidesThumbClickMessage({ showId: "s", row, position: 0, states })).toMatchObject({ type: "slides_take", channel: "preview" });
  });
});

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
