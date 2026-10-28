import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { INITIAL_STAGE_STATE, type StageTimerInstance } from "@overlaysys/core";
import * as channels from "./channels";
import * as timers from "./timers";
import * as stageState from "./stageState";
import { buildSnapshot, readSnapshot, restoreLiveState, writeSnapshot, RESTORE_MAX_AGE_MS } from "./liveState";

let dataDir: string;
let prev: string | undefined;
beforeAll(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "overlaysys-live-"));
  prev = process.env["OVERLAYSYS_DATA_DIR"];
  process.env["OVERLAYSYS_DATA_DIR"] = dataDir;
});
afterAll(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
  if (prev === undefined) delete process.env["OVERLAYSYS_DATA_DIR"];
  else process.env["OVERLAYSYS_DATA_DIR"] = prev;
});

const timer: StageTimerInstance = {
  id: "t1",
  label: "Sermon",
  mode: "countdown",
  durationMs: 60_000,
  overtime: true,
  anchor: 1_000_000,
  source: "manual",
};

describe("liveState", () => {
  it("snapshots only graphics that are on air (not mid-clear)", () => {
    const snap = buildSnapshot(
      [
        { channel: "program", active: { templateId: "lt", data: { name: "A" }, phase: "in", takenAt: 5 } },
        { channel: "preview", active: { templateId: "x", data: {}, phase: "out", takenAt: 6 } },
        { channel: "aux", active: null },
      ],
      [],
      INITIAL_STAGE_STATE,
      100,
    );
    expect(snap.channels).toEqual([{ channel: "program", active: { templateId: "lt", data: { name: "A" }, phase: "in", takenAt: 5 } }]);
  });

  it("restores a fresh snapshot: graphics, timers, stage message", async () => {
    const now = Date.now();
    const ch = `live-${now}`;
    await writeSnapshot({
      savedAt: now - 60_000,
      channels: [{ channel: ch, active: { templateId: "lt", data: { name: "B" }, phase: "in", takenAt: 7 } }],
      timers: [timer],
      stage: { ...INITIAL_STAGE_STATE, message: { text: "Wrap up", sentAt: now - 1000 } },
    });
    expect(await readSnapshot()).not.toBeNull();
    const r = await restoreLiveState(now);
    expect(r).toEqual({ channels: 1, timers: 1 });
    expect(channels.getState(ch).active).toMatchObject({ templateId: "lt", data: { name: "B" }, phase: "in" });
    expect(timers.getTimers().map((t) => t.id)).toEqual(["t1"]);
    expect(stageState.getStageState().message?.text).toBe("Wrap up");
  });

  it("ignores a stale snapshot", async () => {
    const now = Date.now();
    const ch = `stale-${now}`;
    await writeSnapshot({
      savedAt: now - RESTORE_MAX_AGE_MS - 1,
      channels: [{ channel: ch, active: { templateId: "old", data: {}, phase: "in", takenAt: 1 } }],
      timers: [],
      stage: INITIAL_STAGE_STATE,
    });
    expect(await restoreLiveState(now)).toBeNull();
    expect(channels.getState(ch).active).toBeNull();
  });
});
