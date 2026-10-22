import { describe, expect, it } from "vitest";
import { ClientMessageSchema } from "./index";

describe("scripture client messages", () => {
  it("parses all five", () => {
    for (const m of [
      { type: "scripture_take_intro", showId: "s", rowId: "r" },
      { type: "scripture_take_intro", showId: "s", rowId: "r", channel: "preview" },
      { type: "scripture_take_slide", showId: "s", rowId: "r", slideIdx: 0 },
      { type: "scripture_advance", channel: "program", delta: -1 },
      { type: "scripture_goto", channel: "program", slideIdx: 3 },
      { type: "scripture_end", channel: "program" },
    ]) {
      expect(ClientMessageSchema.safeParse(m).success, JSON.stringify(m)).toBe(true);
    }
  });

  it("rejects bad deltas and negative slide indexes", () => {
    expect(ClientMessageSchema.safeParse({ type: "scripture_advance", channel: "p", delta: 2 }).success).toBe(false);
    expect(ClientMessageSchema.safeParse({ type: "scripture_goto", channel: "p", slideIdx: -1 }).success).toBe(false);
    expect(ClientMessageSchema.safeParse({ type: "scripture_take_slide", showId: "s", rowId: "r", slideIdx: 1.5 }).success).toBe(false);
  });
});
