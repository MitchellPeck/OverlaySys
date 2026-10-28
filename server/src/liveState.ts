// Live-state snapshot: what is on air, the stage timers and the confidence
// monitor state, written to disk (debounced) so a server restart mid-service
// doesn't blank every output. On boot a snapshot younger than
// RESTORE_MAX_AGE_MS is put back; an older one is ignored (yesterday's
// lower third must not reappear on Sunday).
//
// Restored: each channel's on-air graphic (`active`, not mid-clear), timers,
// stage state (notes position + booth message). Not restored: song and
// scripture sessions and queued intros (their cursors live in the session
// modules), and video (a restart can't resume playback in sync).

import { promises as fs } from "node:fs";
import path from "node:path";
import writeAtomic from "write-file-atomic";
import { z } from "zod";
import {
  ActiveGraphicSchema,
  StageStateSchema,
  StageTimerInstanceSchema,
  type ChannelState,
} from "@overlaysys/core";
import * as channels from "./channels";
import * as timers from "./timers";
import * as stageState from "./stageState";
import { dataRoot } from "./storage";

export const RESTORE_MAX_AGE_MS = 5 * 60_000;
export const SAVE_DEBOUNCE_MS = 1000;

const SnapshotSchema = z.object({
  savedAt: z.number(),
  channels: z.array(z.object({ channel: z.string(), active: ActiveGraphicSchema })),
  timers: z.array(StageTimerInstanceSchema),
  stage: StageStateSchema,
});
export type LiveSnapshot = z.infer<typeof SnapshotSchema>;

const snapshotFile = (): string => path.join(dataRoot(), "live", "state.json");

/** Pure: the snapshot for the current state. */
export function buildSnapshot(
  states: ChannelState[],
  timerList: LiveSnapshot["timers"],
  stage: LiveSnapshot["stage"],
  now: number = Date.now(),
): LiveSnapshot {
  const onAir = states
    .filter((s) => s.active && s.active.phase !== "out")
    .map((s) => ({ channel: s.channel, active: s.active! }));
  return { savedAt: now, channels: onAir, timers: timerList, stage };
}

export async function writeSnapshot(snap: LiveSnapshot): Promise<void> {
  await fs.mkdir(path.dirname(snapshotFile()), { recursive: true });
  await writeAtomic(snapshotFile(), JSON.stringify(snap));
}

export async function readSnapshot(): Promise<LiveSnapshot | null> {
  try {
    return SnapshotSchema.parse(JSON.parse(await fs.readFile(snapshotFile(), "utf8")));
  } catch {
    return null;
  }
}

/** Restore a fresh-enough snapshot. Returns what was restored (for the log). */
export async function restoreLiveState(now: number = Date.now()): Promise<{ channels: number; timers: number } | null> {
  const snap = await readSnapshot();
  if (!snap) return null;
  if (now - snap.savedAt > RESTORE_MAX_AGE_MS || snap.savedAt > now + 60_000) return null;
  for (const { channel, active } of snap.channels) channels.restoreActive(channel, active);
  timers.restoreTimers(snap.timers);
  stageState.restoreStageState(snap.stage);
  return { channels: snap.channels.length, timers: snap.timers.length };
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let stopFns: (() => void)[] = [];

function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const snap = buildSnapshot(channels.allStates(), timers.getTimers(), stageState.getStageState());
    writeSnapshot(snap).catch((err) => console.warn("[liveState] save failed", err));
  }, SAVE_DEBOUNCE_MS);
  saveTimer.unref?.();
}

/** Save (debounced) on every channel / timer / stage change. */
export function startLiveStatePersistence(): () => void {
  stopLiveStatePersistence();
  stopFns = [
    channels.onAnyChange(scheduleSave),
    timers.subscribeTimers(scheduleSave),
    stageState.subscribeStageState(scheduleSave),
  ];
  return stopLiveStatePersistence;
}

export function stopLiveStatePersistence(): void {
  for (const f of stopFns) f();
  stopFns = [];
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
}
