import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShowSchema, StageSettingsSchema, type Show } from "@overlaysys/core";
import * as shows from "./shows";
import * as stageSettings from "./stageSettings";
import {
  _resetForTest,
  createTimer,
  dispatchTimers,
  getTimers,
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

beforeEach(() => _resetForTest());

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
    ],
  });
  const take = (rowId: string, now = NOW) => onRowTaken({ showId: "s1", rowId }, now);

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

  it("a row without a length clears the item timer but leaves a manual timer alone", async () => {
    const manual = createTimer({ label: "Manual", mode: "countup", overtime: false });
    await take("r1");
    await take("r2");
    expect(getTimers().map((t) => t.id)).toEqual([manual]);
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
    warn.mockRestore();
  });
});
