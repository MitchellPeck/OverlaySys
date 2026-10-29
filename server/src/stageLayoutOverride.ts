// Per-screen stage layout selection state (in memory: a restart returns every
// screen to automatic) and the shared decision used by the feed hub and the
// layout status broadcast. [P2b.33]

import {
  DEFAULT_STAGE_FOLLOWS,
  resolveStageLayout,
  type ChannelConfig,
  type ChannelState,
  type Show,
  type StageLayoutReason,
  type StageLayoutStatus,
} from "@overlaysys/core";
import * as channels from "./channels";
import * as channelConfigs from "./channelConfigs";
import * as shows from "./shows";

const manual = new Map<string, string>();
// Last followed liveRow id seen per stage channel (null = nothing live).
const lastRow = new Map<string, string | null>();

export function setManualStageLayout(channel: string, layoutId: string | null): void {
  if (layoutId) manual.set(channel, layoutId);
  else manual.delete(channel);
}

export function getManualStageLayout(channel: string): string | null {
  return manual.get(channel) ?? null;
}

/**
 * Clears the channel's manual override when the followed output's live row id
 * changed since the last call. Slide/section changes within a row don't count.
 * Returns whether it cleared.
 */
export function noteFollowedRow(channel: string, liveRowId: string | null): boolean {
  const had = lastRow.has(channel);
  const prev = lastRow.get(channel) ?? null;
  lastRow.set(channel, liveRowId);
  if (!had || prev === liveRowId) return false;
  if (!manual.has(channel)) return false;
  manual.delete(channel);
  return true;
}

export const rowKey = (r: { showId: string; rowId: string } | null | undefined): string | null =>
  r ? `${r.showId}/${r.rowId}` : null;

/** Sets a manual layout and records the row currently followed, so the next take clears it. */
export async function armManualStageLayout(cfg: ChannelConfig, layoutId: string | null): Promise<void> {
  const { followed } = await resolveFollowed(cfg);
  noteFollowedRow(cfg.id, rowKey(followed?.liveRow));
  setManualStageLayout(cfg.id, layoutId);
}

let liveRowQueue: Promise<unknown> = Promise.resolve();
/**
 * Call when `channel` takes a row (channels.onLiveRow). Clears manual overrides of
 * the stage screens following it; resolves to the screens that cleared. Calls are
 * serialised so rapid takes are seen in order.
 */
export function handleLiveRowTake(
  channel: string,
  source: { showId: string; rowId: string },
): Promise<string[]> {
  const run = async (): Promise<string[]> => {
    const cleared: string[] = [];
    for (const cfg of await channelConfigs.listChannelConfigs()) {
      if (cfg.kind !== "stage") continue;
      const { followsId } = await resolveFollowed(cfg);
      if (followsId === channel && noteFollowedRow(cfg.id, rowKey(source))) cleared.push(cfg.id);
    }
    return cleared;
  };
  const p = liveRowQueue.then(run, run);
  liveRowQueue = p.catch(() => {});
  return p;
}

/** Test helper. */
export function resetStageLayoutOverrides(): void {
  manual.clear();
  lastRow.clear();
}

/** The channel a stage screen follows (one mirror hop), and its state. */
export async function resolveFollowed(
  cfg: ChannelConfig,
): Promise<{ followsId: string; followed: ChannelState | null }> {
  let followsId = cfg.follows ?? DEFAULT_STAGE_FOLLOWS;
  let followedCfg = await channelConfigs.getChannelConfig(followsId);
  if (followedCfg?.kind !== "stage" && followedCfg?.mirrorOf) {
    followsId = followedCfg.mirrorOf;
    followedCfg = await channelConfigs.getChannelConfig(followsId);
  }
  const followed = followedCfg?.kind === "stage" ? null : channels.getState(followsId);
  return { followsId, followed };
}

/**
 * Whether the followed output is actually showing something. `liveRow` is
 * sticky (clears leave it), so it alone doesn't mean anything is live.
 * Queued (armed, not yet on air) songs/scripture don't count.
 */
export function followedHasContent(st: ChannelState | null | undefined): boolean {
  if (!st) return false;
  return !!(
    st.songSession ||
    st.scriptureSession ||
    st.slidesSession ||
    st.media ||
    (st.active && st.active.phase !== "out")
  );
}

/**
 * manual > item override > type rule > default, for one stage screen. The
 * current item is the last row taken (the sticky liveRow): its layout stays up
 * after its graphic animates out or is cleared, until the next row is taken.
 */
export function decideLayout(
  cfg: ChannelConfig,
  followed: ChannelState | null,
  show: Show | null,
): { layoutId: string | undefined; reason: StageLayoutReason } {
  const row = show && followed?.liveRow ? show.rows.find((r) => r.id === followed.liveRow!.rowId) : undefined;
  const rowOverride = (row as { stageLayouts?: Record<string, string> } | undefined)?.stageLayouts?.[cfg.id];
  return resolveStageLayout({
    manual: getManualStageLayout(cfg.id),
    rowOverride,
    rules: cfg.layoutRules,
    default: cfg.layoutId,
    liveRowKind: row?.kind ?? null,
  });
}

export async function stageLayoutStatuses(): Promise<StageLayoutStatus[]> {
  const configs = await channelConfigs.listChannelConfigs();
  const out: StageLayoutStatus[] = [];
  for (const cfg of configs) {
    if (cfg.kind !== "stage") continue;
    const { followed } = await resolveFollowed(cfg);
    const show = followed?.liveRow ? await shows.getShow(followed.liveRow.showId) : null;
    const d = decideLayout(cfg, followed, show);
    out.push({ channel: cfg.id, layoutId: d.layoutId, reason: d.reason, manual: getManualStageLayout(cfg.id) });
  }
  return out;
}
