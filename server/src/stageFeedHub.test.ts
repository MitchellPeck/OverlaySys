import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ChannelConfigSchema, INITIAL_STAGE_STATE, SPEAKER_LAYOUT, StageLayoutSchema, ShowSchema, type ChannelConfig, type Template } from "@overlaysys/core";
import * as channels from "./channels";
import * as channelConfigs from "./channelConfigs";
import * as shows from "./shows";
import * as songs from "./songs";
import * as templates from "./templates";
import * as stageState from "./stageState";
import * as hub from "./stageFeedHub";
import * as stageLayouts from "./stageLayouts";

const configs = new Map<string, ChannelConfig>();

const timerTpl: Template = {
  id: "timer",
  name: "Countdown",
  version: 1,
  html: "",
  css: "",
  fields: [{ key: "t", label: "Service starts", type: "time", timeMode: "countdown" }],
} as unknown as Template;

const lowerThird: Template = {
  id: "lt",
  name: "Lower Third",
  version: 1,
  html: "",
  css: "",
  fields: [{ key: "name", label: "Name", type: "text" }],
} as unknown as Template;
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

  describe("stage layouts", () => {
    let tmpDir: string;
    let prev: string | undefined;
    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "overlaysys-hub-layouts-"));
      prev = process.env["OVERLAYSYS_DATA_DIR"];
      process.env["OVERLAYSYS_DATA_DIR"] = tmpDir;
      await stageLayouts.reloadStageLayouts();
      cfg({ id: "stage1", name: "Stage 1", kind: "stage", layoutId: "stage-layout-aaaa1111" });
    });
    afterEach(async () => {
      hub.clearPreviewsByOwner("sockA");
      if (prev === undefined) delete process.env["OVERLAYSYS_DATA_DIR"];
      else process.env["OVERLAYSYS_DATA_DIR"] = prev;
      await stageLayouts.reloadStageLayouts();
      await fs.rm(tmpDir, { recursive: true, force: true });
    });
    const mineDraft = () =>
      StageLayoutSchema.parse({ id: "stage-layout-aaaa1111", name: "Mine", widgets: [] });

    it("uses a stored layout named by the channel", async () => {
      await stageLayouts.saveStageLayout(mineDraft());
      expect((await hub.computeFeed("stage1"))!.layout.name).toBe("Mine");
    });

    it("falls back to Speaker when the stored layout is deleted", async () => {
      await stageLayouts.saveStageLayout(mineDraft());
      await stageLayouts.deleteStageLayout("stage-layout-aaaa1111");
      expect((await hub.computeFeed("stage1"))!.layout.id).toBe("speaker");
    });

    it("a preview override wins until cleared by its owner only", async () => {
      hub.setPreview("stage1", { ...SPEAKER_LAYOUT, id: "draft", name: "Draft", builtIn: undefined }, "sockA");
      expect((await hub.computeFeed("stage1"))!.layout.name).toBe("Draft");
      hub.clearPreview("stage1", "sockB");
      expect((await hub.computeFeed("stage1"))!.layout.name).toBe("Draft");
      hub.clearPreviewsByOwner("sockA");
      expect((await hub.computeFeed("stage1"))!.layout.id).not.toBe("draft");
    });

    it("saving a layout clears previews of that layout id", async () => {
      hub.setPreview("stage1", mineDraft(), "sockA");
      hub.clearPreviewsForLayout(mineDraft().id);
      expect(hub.listPreviews()).toEqual([]);
    });

    it("notifies preview subscribers on every mutation", () => {
      const calls: number[] = [];
      const off = hub.subscribePreviews(() => calls.push(hub.listPreviews().length));
      hub.setPreview("stage1", mineDraft(), "sockA");
      hub.clearPreview("stage1", "sockA");
      off();
      expect(calls).toEqual([1, 0]);
    });
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

  it("leaves timers that are only cued on preview out of the feed", async () => {
    vi.mocked(templates.getTemplate).mockImplementation(async (id) => (id === "timer" ? timerTpl : null));
    cfg({ id: "pastor", name: "Pastor", kind: "stage" });
    channels.take("preview", "timer", { t: "5000" });
    channels.take("hub-timer-chan", "timer", { t: "6000" });
    const feed = await hub.computeFeed("pastor");
    const timerChannels = feed?.timers.map((t) => t.channel) ?? [];
    expect(timerChannels).not.toContain("preview");
    expect(timerChannels).toContain("hub-timer-chan");
    channels.setActiveNull("preview");
    channels.setActiveNull("hub-timer-chan");
  });

  it("follows a mirror channel's source", async () => {
    vi.mocked(templates.getTemplate).mockImplementation(async (id) => (id === "lt" ? lowerThird : null));
    vi.mocked(shows.getShow).mockResolvedValue(
      ShowSchema.parse({
        id: "show-m",
        name: "Sunday",
        projectId: "p",
        songs: [],
        rows: [{ kind: "graphic", id: "row-m", templateId: "lt", data: { name: "Welcome" } }],
      }),
    );
    cfg({ id: "program", name: "Program" });
    cfg({ id: "alpha", name: "Alpha", mirrorOf: "program" });
    cfg({ id: "pastor", name: "Pastor", kind: "stage", follows: "alpha" });
    channels.take("program", "lt", { name: "Welcome" }, undefined, undefined, { showId: "show-m", rowId: "row-m" });
    const feed = await hub.computeFeed("pastor");
    expect(feed?.row?.title).toBe("Lower Third — Welcome");
    expect(feed?.current).toEqual({ kind: "graphic", lines: ["Welcome"], reference: "Lower Third" });
    channels.setActiveNull("program");
  });

  it("follows nothing when the mirror source is a stage channel", async () => {
    cfg({ id: "monitor", name: "Monitor", kind: "stage" });
    cfg({ id: "beta", name: "Beta", mirrorOf: "monitor" });
    cfg({ id: "pastor", name: "Pastor", kind: "stage", follows: "beta" });
    channels.take("beta", "tpl", {});
    channels.take("monitor", "tpl", {});
    const feed = await hub.computeFeed("pastor");
    expect(feed?.current.kind).toBe("none");
    channels.setActiveNull("beta");
    channels.setActiveNull("monitor");
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

  it("feeds include the shared stage message", async () => {
    cfg({ id: "pastor", name: "Pastor", kind: "stage" });
    vi.spyOn(stageState, "getStageState").mockReturnValue({ ...INITIAL_STAGE_STATE, message: { text: "Hi", sentAt: 1 } });
    vi.spyOn(stageState, "activeNotes").mockResolvedValue(null);
    expect((await hub.computeFeed("pastor"))?.message).toEqual({ text: "Hi", sentAt: 1 });
  });
});
