import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelConfigSchema, type ChannelConfig } from "@overlaysys/core";
import * as channelConfigs from "./channelConfigs";
import * as shows from "./shows";
import * as songs from "./songs";
import * as templates from "./templates";
import * as hub from "./stageFeedHub";

const configs = new Map<string, ChannelConfig>();
function cfg(raw: Record<string, unknown>) {
  const c = ChannelConfigSchema.parse(raw);
  configs.set(c.id, c);
}

describe("stageFeedHub", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    configs.clear();
    vi.spyOn(channelConfigs, "getChannelConfig").mockImplementation(async (id) => configs.get(id) ?? null);
    vi.spyOn(shows, "getShow").mockResolvedValue(null);
    vi.spyOn(songs, "getSong").mockResolvedValue(null);
    vi.spyOn(templates, "getTemplate").mockResolvedValue(null);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns null for graphics channels", async () => {
    cfg({ id: "program", name: "Program" });
    expect(await hub.computeFeed("program")).toBeNull();
  });

  it("builds a feed for a stage channel with the default layout", async () => {
    cfg({ id: "pastor", name: "Pastor", kind: "stage" });
    const feed = await hub.computeFeed("pastor", 42);
    expect(feed?.layout.id).toBe("speaker");
    expect(feed?.serverNow).toBe(42);
  });

  it("treats a stage channel following itself or another stage channel as following nothing", async () => {
    cfg({ id: "a", name: "A", kind: "stage", follows: "a" });
    cfg({ id: "b", name: "B", kind: "stage", follows: "a" });
    expect((await hub.computeFeed("a"))?.current.kind).toBe("none");
    expect((await hub.computeFeed("b"))?.current.kind).toBe("none");
  });

  it("pushes on subscribe and once per debounce window on invalidation", async () => {
    cfg({ id: "pastor", name: "Pastor", kind: "stage" });
    const send = vi.fn();
    const off = hub.subscribeStage("pastor", send);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    hub.invalidateAll();
    hub.invalidateAll();
    hub.invalidateAll();
    await vi.advanceTimersByTimeAsync(hub.STAGE_FEED_DEBOUNCE_MS + 1);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]![0]).toBe("pastor");
    off();
  });

  it("does not push to graphics-channel subscribers", async () => {
    cfg({ id: "program", name: "Program" });
    const send = vi.fn();
    const off = hub.subscribeStage("program", send);
    hub.invalidateAll();
    await vi.advanceTimersByTimeAsync(hub.STAGE_FEED_DEBOUNCE_MS + 1);
    expect(send).not.toHaveBeenCalled();
    off();
  });

  it("stops pushing after unsubscribe", async () => {
    cfg({ id: "pastor", name: "Pastor", kind: "stage" });
    const send = vi.fn();
    const off = hub.subscribeStage("pastor", send);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    off();
    hub.invalidateAll();
    await vi.advanceTimersByTimeAsync(hub.STAGE_FEED_DEBOUNCE_MS + 1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("logs instead of throwing when the feed cannot be computed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(channelConfigs.getChannelConfig).mockRejectedValue(new Error("storage down"));
    const send = vi.fn();
    let off: () => void = () => {};
    expect(() => {
      off = hub.subscribeStage("pastor", send);
    }).not.toThrow();
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(warn.mock.calls[0]![0]).toContain("[stageFeedHub]");
    expect(send).not.toHaveBeenCalled();
    off();
  });
});
