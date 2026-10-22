import { describe, expect, it } from "vitest";
import { ChannelConfigSchema, DEFAULT_STAGE_FOLLOWS } from "./channelConfig";

describe("ChannelConfigSchema stage fields", () => {
  it("defaults kind to graphics for pre-stage JSON", () => {
    const c = ChannelConfigSchema.parse({ id: "program", name: "Program" });
    expect(c.kind).toBe("graphics");
    expect(c.follows).toBeUndefined();
    expect(c.layoutId).toBeUndefined();
  });

  it("accepts a stage channel with follows and layoutId", () => {
    const c = ChannelConfigSchema.parse({
      id: "pastor",
      name: "Pastor",
      kind: "stage",
      follows: "program",
      layoutId: "speaker",
    });
    expect(c).toMatchObject({ kind: "stage", follows: "program", layoutId: "speaker" });
  });

  it("rejects an unknown kind", () => {
    expect(() => ChannelConfigSchema.parse({ id: "x", name: "X", kind: "bogus" })).toThrow();
  });

  it("exports the default follows target", () => {
    expect(DEFAULT_STAGE_FOLLOWS).toBe("program");
  });
});
