import { describe, expect, it } from "vitest";
import { ClientMessageSchema, ServerMessageSchema } from "./index";

describe("stage layout messages", () => {
  it("decodes set_stage_layout, with null for automatic", () => {
    expect(ClientMessageSchema.safeParse({ type: "set_stage_layout", channel: "s1", layoutId: "lyrics" }).success).toBe(true);
    expect(ClientMessageSchema.safeParse({ type: "set_stage_layout", channel: "s1", layoutId: null }).success).toBe(true);
    expect(ClientMessageSchema.safeParse({ type: "set_stage_layout", channel: "s1" }).success).toBe(false);
  });
  it("decodes stage_layout_status", () => {
    const ok = ServerMessageSchema.safeParse({
      type: "stage_layout_status",
      screens: [
        { channel: "s1", layoutId: "lyrics", reason: "rule:song", manual: null },
        { channel: "s2", reason: "default", manual: "speaker" },
      ],
    });
    expect(ok.success).toBe(true);
    expect(
      ServerMessageSchema.safeParse({ type: "stage_layout_status", screens: [{ channel: "s", reason: "bogus", manual: null }] }).success,
    ).toBe(false);
  });
});
