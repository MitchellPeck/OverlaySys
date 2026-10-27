// Standalone stage timers, held in server memory only (a restart drops them).
// Mutated through dispatchTimers / createTimer (pure reducer in @overlaysys/core).
// The server never ticks: consumers compute the display from anchor / pausedAt.

import { randomUUID } from "node:crypto";
import {
  CURRENT_ITEM_TIMER_ID,
  DEFAULT_STAGE_FOLLOWS,
  reduceTimers,
  type RowSource,
  type Song,
  type StageTimerInstance,
  type Template,
  type TimerAction,
} from "@overlaysys/core";
import type { ServerMessage } from "@overlaysys/ws-protocol";
import * as channelConfigs from "./channelConfigs";
import * as shows from "./shows";
import * as songsStore from "./songs";
import * as templatesStore from "./templates";
import { loadStageSettings } from "./stageSettings";
import { rowTitle } from "./stageFeed";

type Listener = (t: StageTimerInstance[]) => void;

let timers: StageTimerInstance[] = [];
const listeners = new Set<Listener>();

export function getTimers(): StageTimerInstance[] {
  return timers;
}

export function subscribeTimers(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

let itemTimerExternal: () => boolean = () => false;

/** Another source (PCO Live) owns the current-item timer while this returns true. */
export function setItemTimerDriver(fn: () => boolean): void {
  itemTimerExternal = fn;
}

export function isItemTimerDriverExternal(): boolean {
  return itemTimerExternal();
}

export function _resetForTest(): void {
  timers = [];
  itemTimerExternal = () => false;
  listeners.clear();
}

function commit(next: StageTimerInstance[]): void {
  if (next === timers) return;
  timers = next;
  for (const l of [...listeners]) {
    try {
      l(timers);
    } catch (err) {
      console.warn("[timers] listener failed", err);
    }
  }
}

export function dispatchTimers(a: TimerAction, now: number = Date.now()): void {
  commit(reduceTimers(timers, a, now));
}

export function createTimer(input: {
  label: string;
  mode: StageTimerInstance["mode"];
  durationMs?: number;
  overtime: boolean;
}): string {
  const id = randomUUID();
  dispatchTimers({ type: "create", id, ...input });
  return id;
}

export function timersStateMessage(): ServerMessage {
  return { type: "timers_state", timers };
}

/**
 * The channels stage monitors follow: each stage channel's `follows` (default
 * program), a mirror resolved one hop to its source the way
 * stageFeedHub.computeFeed does. With no stage channels, just the default.
 */
export async function stageFollowedChannels(): Promise<Set<string>> {
  const stages = (await channelConfigs.listChannelConfigs()).filter((c) => c.kind === "stage");
  if (stages.length === 0) return new Set([DEFAULT_STAGE_FOLLOWS]);
  const out = new Set<string>();
  for (const cfg of stages) {
    let id = cfg.follows ?? DEFAULT_STAGE_FOLLOWS;
    let followed = await channelConfigs.getChannelConfig(id);
    if (followed?.kind !== "stage" && followed?.mirrorOf) {
      id = followed.mirrorOf;
      followed = await channelConfigs.getChannelConfig(id);
    }
    if (followed?.kind !== "stage") out.add(id);
  }
  return out;
}

/**
 * Called whenever a channel's liveRow is set. Only takes on a channel a stage
 * monitor follows count, so a lower third on a secondary channel can't touch
 * the sermon countdown. A row with a length starts the current-item
 * countdown; retaking the same row (lyric advance, sub-take, a second
 * channel) leaves it running; a row without a length clears it.
 */
export async function onRowTaken(channel: string, source: RowSource, now: number = Date.now()): Promise<void> {
  if (!(await stageFollowedChannels()).has(channel)) return;
  const settings = await loadStageSettings();
  if (!settings.autoItemTimer || isItemTimerDriverExternal()) return;
  const show = await shows.getShow(source.showId);
  const row = show?.rows.find((r) => r.id === source.rowId);
  if (!row) return;

  const lengthSec = row.lengthSec ?? 0;
  if (lengthSec <= 0) {
    dispatchTimers({ type: "clearItem", source: "item" }, now);
    return;
  }

  const songMap = new Map<string, Song>();
  if (row.kind === "song") {
    const song = await songsStore.getSong(row.songId);
    if (song) songMap.set(row.songId, song);
  }
  const templateMap = new Map<string, Template>();
  if (row.kind === "graphic") {
    const tpl = await templatesStore.getTemplate(row.templateId);
    if (tpl) templateMap.set(row.templateId, tpl);
  }

  // Decide on the live state only after the awaits, so a concurrent take of
  // the same row (second channel) sees the timer the first one started.
  const current = timers.find((t) => t.id === CURRENT_ITEM_TIMER_ID);
  if (current && current.source === "item" && current.rowId === row.id) return;
  if (isItemTimerDriverExternal()) return;
  dispatchTimers(
    {
      type: "setItem",
      label: rowTitle(row, songMap, templateMap),
      anchor: now + lengthSec * 1000,
      durationMs: lengthSec * 1000,
      overtime: settings.itemTimerOvertime,
      source: "item",
      rowId: row.id,
    },
    now,
  );
}
