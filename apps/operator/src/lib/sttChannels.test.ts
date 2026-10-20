import { describe, expect, it } from "vitest";
import { channelSelectProblem, toggleChannel } from "./sttChannels";

describe("toggleChannel", () => {
  it("adds and removes, keeping channels in ascending order", () => {
    expect(toggleChannel([18], 17)).toEqual([17, 18]);
    expect(toggleChannel([17, 18], 17)).toEqual([18]);
  });

  it("ignores a 5th channel", () => {
    expect(toggleChannel([1, 2, 3, 4], 5)).toEqual([1, 2, 3, 4]);
  });
});

describe("channelSelectProblem", () => {
  const devices = [{ name: "Dante", channels: 32 }];
  const cfg = { captureMode: "channels" as const, channelDevice: "Dante", channels: [17] };

  it("is null for a valid selection, or in default mode", () => {
    expect(channelSelectProblem(cfg, devices)).toBeNull();
    expect(channelSelectProblem({ ...cfg, captureMode: "default", channels: [] }, devices)).toBeNull();
  });

  it("explains what's missing", () => {
    expect(channelSelectProblem({ ...cfg, channelDevice: "" }, devices)).toMatch(/input device/i);
    expect(channelSelectProblem({ ...cfg, channels: [] }, devices)).toMatch(/at least one channel/i);
    expect(channelSelectProblem({ ...cfg, channels: [33] }, devices)).toMatch(/33/);
  });

  it("doesn't block a saved device that isn't connected right now", () => {
    expect(channelSelectProblem({ ...cfg, channelDevice: "Elsewhere" }, devices)).toBeNull();
  });
});
