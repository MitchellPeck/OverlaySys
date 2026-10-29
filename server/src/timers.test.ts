import { beforeEach, describe, expect, it, vi } from "vitest";
import { CURRENT_ITEM_TIMER_ID, ShowSchema, StageSettingsSchema, type ChannelConfig, type Show } from "@overlaysys/core";
import * as channelConfigs from "./channelConfigs";
import * as shows from "./shows";
import * as stageSettings from "./stageSettings";
import * as templatesStore from "./templates";
import { stageFollowedChannels } from "./stageFollowed";
import {
  _resetForTest,
  createTimer,
  dispatchTimers,
  getTimers,
  onRowEnded,
  onRowTaken,
  setItemTimerDriver,
  subscribeTimers,
} from "./timers";

vi.mock("./shows", () => ({ getShow: vi.fn() }));
vi.mock("./songs", () => ({ getSong: vi.fn(async () => null) }));
vi.mock("./templates", () => ({
  getTemplate: vi.fn(async () => ({ id: "t", name: "Lower Third", fields: [] })),
}));
vi.mock("./stageSettings", () => ({ loadStageSettings: vi.fn() }));
vi.mock("./channelConfigs", () => ({ listChannelConfigs: vi.fn(), getChannelConfig: vi.fn() }));

let configs: ChannelConfig[] = [];
function useConfigs(...list: Partial<ChannelConfig>[]) {
  configs = list.map((c) => ({ renderMode: "normal", kind: "graphics", ...c }) as ChannelConfig);
}

beforeEach(() => {
  _resetForTest();
  useConfigs();
  vi.mocked(channelConfigs.listChannelConfigs).mockImplementation(async () => configs);
  vi.mocked(channelConfigs.getChannelConfig).mockImplementation(async (id) => configs.find((c) => c.id === id) ?? null);
});

describe("stageFollowedChannels", () => {
  it("defaults to program with no stage channels", async () => {
    useConfigs({ id: "program", name: "Program" }, { id: "lt", name: "LT" });
    expect([...(await stageFollowedChannels())]).toEqual(["program"]);
  });

  it("collects each stage channel's follows, defaulting to program", async () => {
    useConfigs(
      { id: "stage1", name: "S1", kind: "stage", follows: "main" },
      { id: "stage2", name: "S2", kind: "stage" },
    );
    expect([...(await stageFollowedChannels())].sort()).toEqual(["main", "program"]);
  });

  it("resolves a followed mirror channel one hop to its source", async () => {
    useConfigs(
      { id: "stage1", name: "S1", kind: "stage", follows: "alpha" },
      { id: "alpha", name: "Alpha", mirrorOf: "program", renderMode: "matte" },
    );
    expect([...(await stageFollowedChannels())]).toEqual(["program"]);
  });

  it("ignores a stage channel that follows another stage channel", async () => {
    useConfigs(
      { id: "stage1", name: "S1", kind: "stage", follows: "stage2" },
      { id: "stage2", name: "S2", kind: "stage", follows: "main" },
    );
    expect([...(await stageFollowedChannels())]).toEqual(["main"]);
  });
});

describe("onRowTaken item countdown", () => {
  const NOW = 1_000_000;
  const show: Show = ShowSchema.parse({
    id: "s1",
    name: "Sunday",
    projectId: "p",
    songs: [],
    rows: [
      { kind: "graphic", id: "r1", templateId: "t", data: {}, lengthSec: 300 },
      { kind: "graphic", id: "r2", templateId: "t", data: {} },
      { kind: "graphic", id: "r3", templateId: "t", data: {}, lengthSec: 100 },
    ],
  });
  const take = (rowId: string, now = NOW, channel = "program") => onRowTaken(channel, { showId: "s1", rowId }, now);

  beforeEach(() => {
    vi.mocked(shows.getShow).mockResolvedValue(show);
    vi.mocked(stageSettings.loadStageSettings).mockResolvedValue(StageSettingsSchema.parse({}));
  });

  it("starts an item countdown for a row with a length", async () => {
    await take("r1");
    expect(getTimers()).toEqual([
      expect.objectContaining({
        id: "current-item",
        label: "Lower Third",
        anchor: NOW + 300_000,
        durationMs: 300_000,
        overtime: true,
        source: "item",
        rowId: "r1",
      }),
    ]);
  });

  it("same row does not restart", async () => {
    await take("r1");
    await take("r1", NOW + 5_000);
    expect(getTimers()[0]!.anchor).toBe(NOW + 300_000);
  });

  it("second channel take of same row is a no-op", async () => {
    await Promise.all([take("r1"), take("r1", NOW + 10)]);
    const items = getTimers().filter((t) => t.id === "current-item");
    expect(items).toHaveLength(1);
    expect(items[0]!.anchor).toBe(NOW + 300_000);
  });

  it("an older take that resolves last does not override a newer take", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let reached!: () => void;
    const atTemplate = new Promise<void>((r) => (reached = r));
    vi.mocked(templatesStore.getTemplate).mockImplementationOnce(async () => {
      reached();
      await gate;
      return { id: "t", name: "Slow", fields: [] } as never;
    });
    const first = take("r1"); // starts first, finishes last
    await atTemplate;
    await take("r3", NOW + 1);
    release();
    await first;
    expect(getTimers()).toEqual([expect.objectContaining({ id: "current-item", rowId: "r3", anchor: NOW + 1 + 100_000 })]);
  });

  it("takes whose followed-channel lookups resolve out of order still honor the newer take", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    vi.mocked(channelConfigs.listChannelConfigs).mockImplementationOnce(async () => {
      await gate;
      return configs;
    });
    const first = take("r1"); // its gate resolves last
    await take("r3", NOW + 1);
    release();
    await first;
    expect(getTimers()).toEqual([expect.objectContaining({ id: "current-item", rowId: "r3", anchor: NOW + 1 + 100_000 })]);
  });

  it("a row without a length clears the item timer but leaves a manual timer alone", async () => {
    const manual = createTimer({ label: "Manual", mode: "countup", overtime: false });
    await take("r1");
    await take("r2");
    expect(getTimers().map((t) => t.id)).toEqual([manual]);
  });

  it("a take on a channel no stage monitor follows leaves the item timer alone", async () => {
    await take("r1");
    await take("r2", NOW + 1000, "lower-thirds");
    expect(getTimers()).toEqual([expect.objectContaining({ id: "current-item", rowId: "r1" })]);
    await take("r1", NOW + 2000, "lower-thirds");
    expect(getTimers()[0]!.anchor).toBe(NOW + 300_000);
  });

  it("a take on a non-followed channel does not start the item timer", async () => {
    await take("r1", NOW, "lower-thirds");
    expect(getTimers()).toEqual([]);
  });

  it("a take on the channel a stage monitor follows drives it", async () => {
    useConfigs({ id: "stage1", name: "S1", kind: "stage", follows: "main" });
    await take("r1");
    expect(getTimers()).toEqual([]);
    await take("r1", NOW, "main");
    expect(getTimers()).toEqual([expect.objectContaining({ id: "current-item", rowId: "r1" })]);
  });

  it("setting off does nothing", async () => {
    vi.mocked(stageSettings.loadStageSettings).mockResolvedValue(StageSettingsSchema.parse({ autoItemTimer: false }));
    await take("r1");
    expect(getTimers()).toEqual([]);
  });

  it("external driver suppresses", async () => {
    setItemTimerDriver(() => true);
    await take("r1");
    expect(getTimers()).toEqual([]);
  });
});

describe("timers engine", () => {
  it("createTimer returns an id present in getTimers", () => {
    const id = createTimer({ label: "Talk", mode: "countdown", durationMs: 60_000, overtime: true });
    expect(getTimers().some((t) => t.id === id)).toBe(true);
  });

  it("fires a listener once per change and not for a no-op", () => {
    const l = vi.fn();
    subscribeTimers(l);
    createTimer({ label: "A", mode: "countup", overtime: false });
    expect(l).toHaveBeenCalledTimes(1);
    dispatchTimers({ type: "pause", id: "missing" });
    expect(l).toHaveBeenCalledTimes(1);
  });

  it("a throwing listener does not stop the others", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const second = vi.fn();
    subscribeTimers(() => {
      throw new Error("boom");
    });
    subscribeTimers(second);
    createTimer({ label: "A", mode: "countup", overtime: false });
    expect(second).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("[timers] listener failed", expect.any(Error));
    warn.mockRestore();
  });
});

describe("onRowEnded clears the item countdown", () => {
  function startItem(rowId: string) {
    dispatchTimers({ type: "setItem", label: "Sermon", anchor: Date.now() + 60_000, durationMs: 60_000, overtime: true, source: "item", rowId });
  }

  it("clears the countdown when its row is cleared or ended on a followed channel", async () => {
    startItem("r1");
    await onRowEnded("program", "r1");
    expect(getTimers().some((t) => t.id === CURRENT_ITEM_TIMER_ID)).toBe(false);
  });

  it("leaves it when a different row ends", async () => {
    startItem("r1");
    await onRowEnded("program", "r9");
    expect(getTimers().some((t) => t.id === CURRENT_ITEM_TIMER_ID)).toBe(true);
  });

  it("leaves it when the row ends on a channel no stage monitor follows", async () => {
    useConfigs({ id: "program", name: "Program" }, { id: "lt", name: "LT" });
    startItem("r1");
    await onRowEnded("lt", "r1");
    expect(getTimers().some((t) => t.id === CURRENT_ITEM_TIMER_ID)).toBe(true);
  });

  it("never touches a PCO-driven countdown", async () => {
    dispatchTimers({ type: "setItem", label: "PCO", anchor: Date.now() + 60_000, durationMs: 60_000, overtime: true, source: "pco", rowId: "r1" });
    await onRowEnded("program", "r1");
    expect(getTimers().some((t) => t.id === CURRENT_ITEM_TIMER_ID)).toBe(true);
  });
});
