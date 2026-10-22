import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as channels from "./channels";
import * as templates from "./templates";

const SRC = { showId: "show-1", rowId: "row-1" };

describe("channel liveRow", () => {
  beforeEach(() => {
    vi.spyOn(templates, "getTemplate").mockResolvedValue(null);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a sourced take sets liveRow", () => {
    channels.take("lr-a", "tpl", {}, undefined, undefined, SRC);
    expect(channels.getState("lr-a").liveRow).toEqual(SRC);
  });

  it("an unsourced take keeps the previous liveRow", () => {
    channels.take("lr-b", "tpl", {}, undefined, undefined, SRC);
    channels.take("lr-b", "hotcard", {});
    expect(channels.getState("lr-b").liveRow).toEqual(SRC);
  });

  it("clear keeps liveRow", () => {
    channels.take("lr-c", "tpl", {}, undefined, undefined, SRC);
    channels.clear("lr-c");
    expect(channels.getState("lr-c").liveRow).toEqual(SRC);
  });

  it("take_pvw_to_pgm carries the preview liveRow", () => {
    channels.take("lr-pvw", "tpl", {}, undefined, undefined, SRC);
    channels.takePvwToPgm("lr-pvw", "lr-pgm");
    expect(channels.getState("lr-pgm").liveRow).toEqual(SRC);
  });

  it("media_take with showId sets liveRow from rowId", () => {
    channels.mediaTake("lr-m", {
      rowId: "vid-1",
      showId: "show-1",
      assetUrl: "/assets/a.mp4",
      volume: 1,
      endAction: "clear",
    });
    expect(channels.getState("lr-m").liveRow).toEqual({ showId: "show-1", rowId: "vid-1" });
  });

  it("setLiveRow emits to channel and any-change listeners", () => {
    const seen: string[] = [];
    const off = channels.onAnyChange((ch) => seen.push(ch));
    const perChannel = vi.fn();
    const unsub = channels.subscribe("lr-d", perChannel);
    perChannel.mockClear();
    channels.setLiveRow("lr-d", SRC);
    expect(perChannel).toHaveBeenCalledTimes(1);
    expect(seen).toContain("lr-d");
    off();
    unsub();
  });

  it("onAnyChange fires even when the channel has no direct subscribers", () => {
    const seen: string[] = [];
    const off = channels.onAnyChange((ch) => seen.push(ch));
    channels.take("lr-e", "tpl", {});
    expect(seen).toContain("lr-e");
    off();
  });

  it("allStates includes channels that have been touched", () => {
    channels.take("lr-f", "tpl", {});
    expect(channels.allStates().map((s) => s.channel)).toContain("lr-f");
  });
});
