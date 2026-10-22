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

  it("promote of a sourced preview cue sets the program liveRow", () => {
    channels.take("lr-pvw-a", "tpl", {}, undefined, undefined, SRC);
    channels.takePvwToPgm("lr-pvw-a", "lr-pgm-a");
    expect(channels.getState("lr-pgm-a").liveRow).toEqual(SRC);
  });

  it("promote of a later unsourced preview cue leaves the program liveRow alone", () => {
    const OTHER = { showId: "show-1", rowId: "row-2" };
    channels.take("lr-pvw-b", "tpl", {}, undefined, undefined, SRC);
    channels.takePvwToPgm("lr-pvw-b", "lr-pgm-b");
    channels.setLiveRow("lr-pgm-b", OTHER);
    channels.take("lr-pvw-b", "hotcard", {});
    channels.takePvwToPgm("lr-pvw-b", "lr-pgm-b");
    expect(channels.getState("lr-pgm-b").liveRow).toEqual(OTHER);
  });

  it("sourced cue, clear preview, unsourced cue, promote leaves the program liveRow alone", () => {
    const PGM = { showId: "show-1", rowId: "row-pgm" };
    channels.setLiveRow("lr-pgm-c", PGM);
    channels.take("lr-pvw-c", "tpl", {}, undefined, undefined, SRC);
    channels.clear("lr-pvw-c");
    channels.take("lr-pvw-c", "hotcard", {});
    channels.takePvwToPgm("lr-pvw-c", "lr-pgm-c");
    expect(channels.getState("lr-pgm-c").liveRow).toEqual(PGM);
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

  it("onLiveRow fires for sourced takes and setLiveRow, not unsourced takes", () => {
    const seen: string[] = [];
    const off = channels.onLiveRow((ch, src) => seen.push(`${ch}:${src.rowId}`));
    try {
      channels.take("olr", "tpl", {}, undefined, undefined, { showId: "s", rowId: "a" });
      channels.take("olr", "tpl", {});
      channels.setLiveRow("olr", { showId: "s", rowId: "b" });
      expect(seen).toEqual(["olr:a", "olr:b"]);
    } finally {
      off();
    }
  });
});
